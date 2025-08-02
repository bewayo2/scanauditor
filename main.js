const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs-extra');
const pdfParse = require('pdf-parse');
const ComprehensiveAnalyzer = require('./comprehensive_analyzer');


let mainWindow;
let server;
let ollamaStatus = 'disconnected';

// Express server setup
const setupBackend = () => {
  const expressApp = express();
  const PORT = 3001;

  // Middleware
  expressApp.use(cors());
  expressApp.use(express.json());
  expressApp.use(express.static('public'));

  // Configure multer for file uploads
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(__dirname, 'uploads');
      fs.ensureDirSync(uploadDir);
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + '-' + file.originalname);
    }
  });

  const upload = multer({ storage });

  // Test Ollama connection
  const testOllamaConnection = async () => {
    try {
      const response = await axios.get('http://127.0.0.1:11434/api/tags');
      ollamaStatus = 'connected';
      console.log('Ollama connected successfully');
      return true;
    } catch (error) {
      ollamaStatus = 'error';
      console.error('Ollama connection failed:', error.message);
      return false;
    }
  };

  // Initialize Ollama models
  const initializeModels = async () => {
    try {
      console.log('Initializing qwen2.5vl:7b model for OCR...');
      const qwenResponse = await axios.post('http://127.0.0.1:11434/api/pull', {
        name: 'qwen2.5vl:7b'
      });
      console.log('Qwen2.5-VL model initialization started');
      
      console.log('Initializing gemma3n:latest model for analysis...');
      const gemmaResponse = await axios.post('http://127.0.0.1:11434/api/pull', {
        name: 'gemma3n:latest'
      });
      console.log('Gemma3n model initialization started');
      
      return true;
    } catch (error) {
      console.error('Model initialization failed:', error.message);
      return false;
    }
  };

  // API Routes
  expressApp.get('/api/status', (req, res) => {
    res.json({ 
      status: 'running', 
      ollama: ollamaStatus,
      timestamp: new Date().toISOString()
    });
  });

  expressApp.post('/api/analyze', upload.array('files'), async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }

      const results = [];
      
      for (const file of req.files) {
        const analysis = await analyzeFile(file);
        results.push(analysis);
      }

      res.json({ results });
    } catch (error) {
      console.error('Analysis error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Convert PDF to images using Python script
  const convertPDFToImagesPython = async (pdfPath, outputDir, pageNumber = 1, dpi = 150) => {
    const { spawn } = require('child_process');
    
    try {
      console.log('=== PDF TO IMAGE CONVERSION (PYTHON) START ===');
      console.log('PDF Path:', pdfPath);
      console.log('Output Directory:', outputDir);
      console.log('Page Number:', pageNumber);
      console.log('DPI:', dpi);
      
      // Ensure output directory exists
      await fs.ensureDir(outputDir);
      
      // Prepare Python command
      const pythonPath = path.join(__dirname, 'pdf_converter_env', 'Scripts', 'python.exe');
      const scriptPath = path.join(__dirname, 'pdf_to_images.py');
      
      console.log('Python Path:', pythonPath);
      console.log('Script Path:', scriptPath);
      
      return new Promise((resolve, reject) => {
        const pythonProcess = spawn(pythonPath, [
          scriptPath,
          pdfPath,
          outputDir,
          pageNumber.toString(),
          dpi.toString()
        ]);
        
        let stdout = '';
        let stderr = '';
        
        pythonProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });
        
        pythonProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        
        pythonProcess.on('close', (code) => {
          console.log('Python process exit code:', code);
          console.log('Python stdout:', stdout);
          if (stderr) console.log('Python stderr:', stderr);
          
          if (code === 0) {
            try {
              const result = JSON.parse(stdout.trim());
              if (result.success) {
                console.log('=== PDF TO IMAGE CONVERSION SUCCESS ===');
                console.log('Image created at:', result.image_path);
                resolve(result);
              } else {
                console.error('Python script failed:', result.error);
                reject(new Error(result.error));
              }
            } catch (parseError) {
              console.error('Failed to parse Python output:', parseError);
              reject(parseError);
            }
          } else {
            reject(new Error(`Python process failed with code ${code}: ${stderr}`));
          }
        });
        
        pythonProcess.on('error', (error) => {
          console.error('Failed to start Python process:', error);
          reject(error);
        });
      });
      
    } catch (error) {
      console.error('=== PDF TO IMAGE CONVERSION FAILED ===');
      console.error('Error:', error);
      throw error;
    }
  };

    // File analysis function using comprehensive analyzer
  const analyzeFile = async (file) => {
    try {
      const analyzer = new ComprehensiveAnalyzer();
      return await analyzer.analyzeFile(file);
    } catch (error) {
      console.error(`Error analyzing file ${file.originalname}:`, error);
      return {
        filename: file.originalname,
        filepath: file.path,
        analysis: {
          error: error.message,
          fileInformation: { fileName: file.originalname, scanDate: new Date().toISOString().split('T')[0], totalPages: 0 },
          summaryTable: [],
          detailedFindings: {},
          recommendations: {},
          safetyAssessment: { safeForUse: false, reason: 'Analysis failed', riskLevel: 'high', immediateActions: ['Manual review required'] },
          complianceStatus: 'needs-review',
          priorityIssues: ['Analysis failed']
        },
        timestamp: new Date().toISOString()
      };
    }
  };

  // Start server
  server = expressApp.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
  });

  // Test Ollama connection on startup with retry
  const connectToOllama = async () => {
    let retries = 0;
    const maxRetries = 5;
    
    while (retries < maxRetries) {
      console.log(`Attempting to connect to Ollama (attempt ${retries + 1}/${maxRetries})...`);
      const connected = await testOllamaConnection();
      if (connected) {
        await initializeModels();
        break;
      }
      retries++;
      if (retries < maxRetries) {
        console.log('Waiting 2 seconds before retry...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    if (retries >= maxRetries) {
      console.log('Failed to connect to Ollama after multiple attempts. Please ensure Ollama is running.');
    }
  };
  
  connectToOllama();

  return expressApp;
};

// Create main window
const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    title: 'ScanAuditor - Medical Records Analysis'
  });

  mainWindow.loadFile('index.html');

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
};

// App event handlers
app.whenReady().then(() => {
  setupBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers
ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Text Files', extensions: ['txt', 'pdf', 'doc', 'docx'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return result.filePaths;
});

ipcMain.handle('get-backend-status', async () => {
  try {
    const response = await axios.get('http://localhost:3001/api/status');
    return response.data;
  } catch (error) {
    return { status: 'error', ollama: 'disconnected', error: error.message };
  }
});

// Cleanup on app quit
app.on('before-quit', () => {
  if (server) {
    server.close();
  }
}); 