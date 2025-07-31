const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs-extra');
const pdfParse = require('pdf-parse');


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

  // Initialize Ollama model
  const initializeModel = async () => {
    try {
      console.log('Initializing qwen2.5vl:7b model...');
      const response = await axios.post('http://127.0.0.1:11434/api/pull', {
        name: 'qwen2.5vl:7b'
      });
      console.log('Model initialization started');
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

  // File analysis function
  const analyzeFile = async (file) => {
    try {
             const fileName = file.originalname;
       let fileContent = '';
       let isScannedPDF = false;
       let useVisionAnalysis = false;
       let imagePath = null;
       let conversionResult = null;
       let pdfData = null;
       let allImagePaths = []; // Declare allImagePaths at function scope
      
      // Handle different file types
      if (fileName.toLowerCase().endsWith('.pdf')) {
        // Extract text from PDF
        const pdfBuffer = await fs.readFile(file.path);
        pdfData = await pdfParse(pdfBuffer);
        fileContent = pdfData.text;
        
        // For multi-page analysis, always convert to images to analyze each page individually
        if (pdfData.numpages > 1) {
          isScannedPDF = true;
          console.log('=== MULTI-PAGE PDF DETECTED - CONVERTING ALL PAGES FOR ANALYSIS ===');
          console.log('Filename:', fileName);
          console.log('PDF pages:', pdfData.numpages);
                   console.log('Initial text content length:', fileContent.length);
         console.log('First 1000 characters of extracted text:');
         console.log(fileContent.substring(0, 1000));
         console.log('Converting all pages to images for page-by-page hospital number analysis');
         console.log('=== END DEBUG ===');
          
          // Try PDF to image conversion using Python
          try {
            console.log('=== STARTING PDF TO IMAGE CONVERSION ===');
            const outputDir = path.join(__dirname, 'temp_images');
            // Convert ALL pages to detect multiple patients
            const pagesToConvert = pdfData.numpages;
            console.log(`Converting ALL ${pagesToConvert} pages to detect multiple patients`);
                         conversionResult = await convertPDFToImagesPython(file.path, outputDir, pagesToConvert, 400);
            
            if (conversionResult.success) {
              imagePath = conversionResult.primary_image_path;
              useVisionAnalysis = true;
              console.log('=== PDF TO IMAGE CONVERSION COMPLETED ===');
              console.log(`${conversionResult.num_pages} pages converted`);
              console.log('Primary image created at:', imagePath);
              if (conversionResult.image_paths) {
                console.log('All image paths:', conversionResult.image_paths);
              }
              console.log('Image dimensions:', conversionResult.width, 'x', conversionResult.height);
            }
            
          } catch (conversionError) {
            console.error('=== PDF TO IMAGE CONVERSION FAILED ===');
            console.error('Failed to convert PDF to image:', conversionError);
            console.error('Will continue with text-only analysis');
            // Continue with text-only analysis
          }
        } else {
          console.log('=== PDF ANALYSIS DEBUG ===');
          console.log('Filename:', fileName);
          console.log('PDF pages:', pdfData.numpages);
          console.log('Text content length:', fileContent.length);
          console.log('First 500 characters of extracted text:');
          console.log(fileContent.substring(0, 500));
          console.log('=== END DEBUG ===');
        }
      } else {
        // Handle text files
        fileContent = await fs.readFile(file.path, 'utf8');
        console.log('=== TEXT FILE ANALYSIS DEBUG ===');
        console.log('Filename:', fileName);
        console.log('File content length:', fileContent.length);
        console.log('First 500 characters of content:');
        console.log(fileContent.substring(0, 500));
        console.log('=== END DEBUG ===');
      }

            // Prepare prompt for analysis
      let prompt;
      
      if (isScannedPDF && useVisionAnalysis && imagePath) {
        // Use vision analysis with all converted images
                 prompt = `You are analyzing ${allImagePaths.length} pages of a medical document (filename: ${fileName}) to find HOSPITAL NUMBERS.

TASK: Extract ALL 5-6 digit numbers that could be hospital/patient identifiers from each page.

LOOK FOR hospital numbers in these contexts:
- "Hospital #" or "Hospital No." or "Hospital Number"
- "Medical Record No." or "Medical Record Number" or "MRN"
- "Admitting No." or "Admit No." or "Admission No."
- "Record No." or "Record Number"
- "Reg. Pauper #" or "Registration No."
- "Patient ID" or "Patient Number"
- "Case No." or "Case Number"
- ANY 5-6 digit number that appears to be a patient identifier

HOSPITAL NUMBER FORMAT:
- Exactly 5 or 6 digits long
- Examples: 12345, 123456, 98765, 987654

ALSO LOOK FOR:
- Numbers in headers or titles
- Numbers near patient information
- Numbers that appear multiple times
- Any 5-6 digit sequence that could be a patient ID

IGNORE these contexts (do NOT extract numbers from):
- Phone numbers: "Phone: 555-1234" or "Tel: 123-456-7890"
- Dates: "DOB: 01/01/1980" or "Date: 12/31/2023"
- Vital signs: "BP: 120/80", "Pulse: 72", "Temp: 98.6", "RBS: 120", "Weight: 150"
- Room numbers: "Room 123" or "Bed 456"
- Any other medical measurements or identifiers

BE THOROUGH: Look at every 5-6 digit number on each page and determine if it could be a hospital/patient identifier.

For each page, if you find ANY numbers that could be hospital numbers, report them. If no hospital numbers found, don't report that page.

Respond in JSON format:
{
  "pagesWithHospitalNumbers": [
    {"pageNumber": 1, "hospitalNumbers": ["REAL_NUMBER_FOUND"]},
    {"pageNumber": 3, "hospitalNumbers": ["ANOTHER_REAL_NUMBER"]}
  ],
  "uniqueHospitalNumbers": ["LIST_OF_ACTUAL_NUMBERS_FOUND"],
  "multiplePatients": true/false,
  "totalPagesAnalyzed": ${allImagePaths.length}
}

IMPORTANT: Only report ACTUAL hospital numbers you can see in the document. Do NOT make up example numbers like 12345, 67890, etc. If you cannot clearly see any hospital numbers, return empty arrays.

Be thorough - extract any 5-6 digit number that could reasonably be a hospital/patient identifier.`;
      } else if (isScannedPDF) {
                 // Fallback when image conversion failed
         prompt = `Extract ONLY hospital numbers from this scanned medical document (filename: ${fileName}).

Image conversion failed. Text extracted: "${fileContent}"

Look for hospital numbers (5-6 digits) after: "Hospital #", "Medical Record No.", "MRN:", "Admitting No.", "Record No."

Respond in JSON format:
{
  "pagesWithHospitalNumbers": [],
  "uniqueHospitalNumbers": [],
  "multiplePatients": false,
  "totalPagesAnalyzed": 1,
  "issues": ["Image conversion failed - cannot analyze handwritten content"]
}

If no hospital numbers found in extracted text, return empty arrays.`;
      } else {
                 prompt = `Extract ONLY hospital numbers from this medical document (filename: ${fileName}).

Document content: "${fileContent}"

Look for hospital numbers (5-6 digits) after: "Hospital #", "Medical Record No.", "MRN:", "Admitting No.", "Record No."

Respond in JSON format:
{
  "pagesWithHospitalNumbers": [{"pageNumber": 1, "hospitalNumbers": ["12345"]}],
  "uniqueHospitalNumbers": ["list of unique hospital numbers"], 
  "multiplePatients": false,
  "totalPagesAnalyzed": 1
}

If no hospital numbers found, return empty arrays.`;
      }

             // Call Ollama API
       let requestData = {
         model: 'qwen2.5vl:7b',
         prompt: prompt,
         stream: false
       };

      // Add ALL images if available for vision analysis
      if (imagePath && useVisionAnalysis) {
        try {
          console.log('=== PREPARING MULTI-PAGE VISION ANALYSIS ===');
          
                                // Get all image paths from the conversion result
            if (conversionResult && conversionResult.image_paths) {
              allImagePaths = conversionResult.image_paths;
              // Limit to first 5 pages for testing - see if model can handle more than 2
              if (allImagePaths.length > 5) {
                console.log('=== TESTING: Limiting to first 5 pages to see if model processes more than 2 ===');
                allImagePaths = allImagePaths.slice(0, 5);
              }
            } else {
              allImagePaths = [imagePath]; // Fallback to single image
            }
          
          console.log(`Processing ${allImagePaths.length} pages for vision analysis`);
          
          const base64Images = [];
          let totalImageSize = 0;
          
          for (let i = 0; i < allImagePaths.length; i++) {
            const imgPath = allImagePaths[i];
            console.log(`Reading image ${i + 1}/${allImagePaths.length}: ${imgPath}`);
            
            const imageBuffer = await fs.readFile(imgPath);
            const base64Image = imageBuffer.toString('base64');
            base64Images.push(base64Image);
            totalImageSize += imageBuffer.length;
            
            console.log(`Page ${i + 1}: ${imageBuffer.length} bytes`);
          }
          
          requestData.images = base64Images;
          console.log(`Added ${base64Images.length} images to vision analysis request`);
          console.log(`Total image data: ${totalImageSize} bytes`);
          console.log('=== MULTI-PAGE VISION ANALYSIS PREPARED ===');
        } catch (imageError) {
          console.error('=== VISION ANALYSIS PREPARATION FAILED ===');
          console.error('Failed to read images for vision analysis:', imageError);
          console.error('Will proceed with text-only analysis');
        }
      } else {
        console.log('=== NO VISION ANALYSIS ===');
        console.log('Image path available:', !!imagePath);
        console.log('Use vision analysis flag:', useVisionAnalysis);
      }

             console.log('=== SENDING REQUEST TO OLLAMA ===');
       console.log('Request data keys:', Object.keys(requestData));
       console.log('Prompt length:', prompt.length, 'characters');
       
       // DEBUG: First send a simple text extraction request to see what the AI can read
       if (imagePath && useVisionAnalysis && allImagePaths.length > 0) {
         console.log('=== DEBUG: SENDING TEXT EXTRACTION REQUEST ===');
         const debugPrompt = `Look at this medical document image and extract ALL text you can see. Focus on any numbers, especially 5-6 digit sequences. List everything you can read clearly.`;
         
                   const debugRequestData = {
            model: 'qwen2.5vl:7b',
            prompt: debugPrompt,
            stream: false,
            images: [requestData.images[0]] // Just use first image for debug
          };
         
         try {
           const debugResponse = await axios.post('http://127.0.0.1:11434/api/generate', debugRequestData);
           console.log('=== DEBUG TEXT EXTRACTION RESULT ===');
           console.log('AI can see this text:');
           console.log(debugResponse.data.response);
           console.log('=== END DEBUG TEXT EXTRACTION ===');
         } catch (debugError) {
           console.log('Debug text extraction failed:', debugError.message);
         }
       }

      const response = await axios.post('http://127.0.0.1:11434/api/generate', requestData);

      // Clean the response to extract JSON from markdown if needed
      let responseText = response.data.response;
      
             // Debug: Log the AI response
       console.log('=== AI RESPONSE DEBUG ===');
       console.log('Raw AI response:');
       console.log(responseText);
       console.log('=== END AI RESPONSE DEBUG ===');
       
               // Parse and log detailed page-by-page analysis
        try {
          const parsedResponse = JSON.parse(responseText.replace(/```json\n?/g, '').replace(/```\n?/g, ''));
          if (parsedResponse.pagesWithHospitalNumbers && parsedResponse.pagesWithHospitalNumbers.length > 0) {
            console.log('=== DETAILED PAGE ANALYSIS ===');
            console.log(`AI detected hospital numbers on ${parsedResponse.pagesWithHospitalNumbers.length} pages:`);
            parsedResponse.pagesWithHospitalNumbers.forEach(page => {
              console.log(`  Page ${page.pageNumber}: Hospital Numbers [${page.hospitalNumbers.join(', ')}]`);
            });
            console.log(`Unique hospital numbers found: ${parsedResponse.uniqueHospitalNumbers.join(', ')}`);
            console.log(`Multiple patients: ${parsedResponse.multiplePatients}`);
            console.log('=== END DETAILED ANALYSIS ===');
          } else {
            console.log('=== NO HOSPITAL NUMBERS DETECTED ===');
            console.log('AI found no hospital numbers on any pages');
            console.log('=== END NO HOSPITAL NUMBERS ===');
          }
        } catch (parseError) {
          console.log('=== PARSING ERROR ===');
          console.log('Could not parse AI response for detailed logging:', parseError.message);
          console.log('=== END PARSING ERROR ===');
        }
      
      // Remove markdown code blocks if present
      if (responseText.includes('```json')) {
        responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      }
      
             // Try to parse as JSON
       let analysis;
       try {
         analysis = JSON.parse(responseText);
         
                 // Validate and correct hallucinated responses for scanned PDFs (only when vision analysis is NOT available)
        if (isScannedPDF && !useVisionAnalysis && analysis.patientName && analysis.patientName !== 'Unable to extract') {
          // Check if the patient name seems to be made up (not in filename and not in extracted text)
          const fileNameLower = fileName.toLowerCase();
          const extractedTextLower = fileContent.toLowerCase();
          const patientNameLower = analysis.patientName.toLowerCase();
          
          const nameInFilename = fileNameLower.includes(patientNameLower);
          const nameInText = extractedTextLower.includes(patientNameLower);
          
          if (!nameInFilename && !nameInText && fileContent.length < 100) {
            console.log('Detected potential hallucination, correcting response');
            analysis.patientName = 'Unable to extract';
            analysis.filenameMatch = false;
            analysis.singlePatient = false;
            analysis.onePatientOnly = false;
            analysis.confidence = 0.0;
            analysis.issues = ['Scanned document - limited text extraction', 'AI model hallucinated patient name - corrected'];
          }
                 } else if (isScannedPDF && useVisionAnalysis) {
           console.log('Vision analysis successful - validating AI analysis');
           
           // Validate the AI response for potential hallucination
           if (analysis.pagesWithHospitalNumbers && analysis.pagesWithHospitalNumbers.length > 0) {
             console.log('Validating AI response for hallucination...');
             
             // For hospital numbers, we don't validate against filename since they're numeric identifiers
             // Instead, validate that the numbers are reasonable (5-6 digits)
             const allHospitalNumbers = analysis.pagesWithHospitalNumbers.flatMap(page => page.hospitalNumbers);
             const validNumbers = allHospitalNumbers.filter(hn => /^\d{5,6}$/.test(hn));
             
             if (validNumbers.length !== allHospitalNumbers.length) {
               console.log('WARNING: AI reported some invalid hospital numbers');
               console.log(`Valid numbers: ${validNumbers.join(', ')}`);
               console.log(`All reported: ${allHospitalNumbers.join(', ')}`);
               
               // Filter out invalid numbers
               analysis.pagesWithHospitalNumbers = analysis.pagesWithHospitalNumbers.map(page => ({
                 ...page,
                 hospitalNumbers: page.hospitalNumbers.filter(hn => /^\d{5,6}$/.test(hn))
               })).filter(page => page.hospitalNumbers.length > 0);
               
               analysis.uniqueHospitalNumbers = [...new Set(
                 analysis.pagesWithHospitalNumbers.flatMap(page => page.hospitalNumbers)
               )];
               
               console.log('=== VALIDATION CORRECTION APPLIED ===');
               console.log('Invalid hospital numbers filtered out');
               console.log('=== END VALIDATION CORRECTION ===');
             } else {
               console.log('=== VALIDATION PASSED ===');
               console.log('All reported hospital numbers are valid 5-6 digit numbers');
               console.log('=== END VALIDATION PASSED ===');
             }
           }
           
                       // ADD FALLBACK REGEX EXTRACTION if AI found no hospital numbers
            if (!analysis.pagesWithHospitalNumbers || analysis.pagesWithHospitalNumbers.length === 0) {
              console.log('=== AI FOUND NO HOSPITAL NUMBERS - TRYING REGEX FALLBACK ===');
              
              // Try to extract hospital numbers using regex from the extracted text
              const hospitalNumberRegex = /\b\d{5,6}\b/g;
              const extractedNumbers = new Set();
              
              // Extract text from PDF and look for 5-6 digit numbers
              if (pdfData && pdfData.text) {
                const matches = pdfData.text.match(hospitalNumberRegex);
                if (matches) {
                  matches.forEach(match => extractedNumbers.add(match));
                  console.log(`Regex fallback found numbers: ${Array.from(extractedNumbers).join(', ')}`);
                  
                  // Create a simple result with all found numbers on page 1
                  analysis.pagesWithHospitalNumbers = [{
                    pageNumber: 1,
                    hospitalNumbers: Array.from(extractedNumbers)
                  }];
                  analysis.uniqueHospitalNumbers = Array.from(extractedNumbers);
                  analysis.multiplePatients = extractedNumbers.size > 1;
                  analysis.totalPagesAnalyzed = pdfData.numpages;
                  analysis.issues = ['AI vision analysis found no hospital numbers - used regex fallback'];
                  
                  console.log('=== REGEX FALLBACK APPLIED ===');
                }
              }
            }
            
            // ALWAYS RUN REGEX EXTRACTION AS PRIMARY METHOD (like your Python script)
            console.log('=== RUNNING REGEX EXTRACTION AS PRIMARY METHOD ===');
            const hospitalNumberRegex = /\b\d{5,6}\b/g;
            const allExtractedNumbers = new Set();
            
            if (pdfData && pdfData.text) {
              const matches = pdfData.text.match(hospitalNumberRegex);
              if (matches) {
                matches.forEach(match => allExtractedNumbers.add(match));
                console.log(`Regex extraction found ALL numbers: ${Array.from(allExtractedNumbers).join(', ')}`);
                
                // Override AI results with regex results (more reliable)
                analysis.pagesWithHospitalNumbers = [{
                  pageNumber: 1,
                  hospitalNumbers: Array.from(allExtractedNumbers)
                }];
                analysis.uniqueHospitalNumbers = Array.from(allExtractedNumbers);
                analysis.multiplePatients = allExtractedNumbers.size > 1;
                analysis.totalPagesAnalyzed = pdfData.numpages;
                analysis.issues = ['Used regex extraction as primary method (like Python script)'];
                
                console.log('=== REGEX EXTRACTION APPLIED AS PRIMARY METHOD ===');
              } else {
                console.log('=== NO HOSPITAL NUMBERS FOUND BY REGEX ===');
              }
            }
         }
       } catch (parseError) {
         console.log('Failed to parse JSON response, using fallback analysis');
                   analysis = {
            pagesWithHospitalNumbers: [],
            uniqueHospitalNumbers: [],
            multiplePatients: false,
            totalPagesAnalyzed: 1,
            issues: ['AI response parsing failed'],
            rawResponse: responseText
          };
       }
      
      return {
        filename: fileName,
        filepath: file.path,
        analysis: analysis,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error(`Error analyzing file ${file.originalname}:`, error);
             return {
         filename: file.originalname,
         filepath: file.path,
         analysis: {
           error: error.message,
           pagesWithHospitalNumbers: [],
           uniqueHospitalNumbers: [],
           multiplePatients: false,
           totalPagesAnalyzed: 1,
           issues: ['Analysis failed']
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
        await initializeModel();
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