const fs = require('fs-extra');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GEMINI_FLASH_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

async function processFiles(selectedFiles = []) {
  try {
    const dataDir = path.join(process.cwd(), 'data');
    const resultDir = path.join(process.cwd(), 'result');
    
    await fs.ensureDir(resultDir);
    let files = (await fs.readdir(dataDir)).filter(file => file.endsWith('.txt'));
    
    // Filter files if specific files are selected
    if (selectedFiles.length > 0) {
      files = files.filter(file => selectedFiles.includes(file));
      if (files.length === 0) {
        console.log('No matching files found in data directory.');
        return;
      }
    }
    
    for (const file of files) {
      const filePath = path.join(dataDir, file);
      
      // Read file as UTF-8 (default)
      let content = await fs.readFile(filePath, 'utf8');
      
      // (Optional) Fallback to binary if UTF-8 fails (for GB18030 files)
      if (containsMalformedUTF8(content)) {
        console.warn(`Falling back to binary decoding for ${file}`);
        const buffer = await fs.readFile(filePath);
        content = buffer.toString('binary'); // Simple fallback (not perfect)
      }
      
      // Process chapters
      const chapters = [];
      let currentChapter = null;
      
      const lines = content.split('\n');
      for (const line of lines) {
        if (line.match(/^第\d+章/)) {
          if (currentChapter) chapters.push(currentChapter);
          currentChapter = { title: line.trim(), content: [] };
        } else if (currentChapter) {
          if (line.trim() || currentChapter.content.length > 0) {
            currentChapter.content.push(line);
          }
        }
      }
      
      if (currentChapter) chapters.push(currentChapter);
      
      chapters.forEach(chapter => {
        chapter.content = chapter.content.join('\n').trim();
      });
      
      const outputFile = path.join(resultDir, `${path.basename(file, '.txt')}.json`);
      await fs.writeJson(outputFile, { chapters }, { spaces: 2 });
      console.log(`Processed ${file} -> ${path.basename(outputFile)}`);
      
      // Translate the file
      await translateJsonFile(outputFile);
    }
    
    console.log('All selected files processed and translated successfully!');
  } catch (error) {
    console.error('Error processing files:', error);
    process.exit(1);
  }
}

async function translateJsonFile(filePath) {
  try {
    const data = await fs.readJson(filePath);
    const translatedChapters = [];
    
    // Configure safety settings (lowest possible filtering)
    const safetySettings = [
      {
        category: 'HARM_CATEGORY_HARASSMENT',
        threshold: 'BLOCK_ONLY_HIGH'
      },
      {
        category: 'HARM_CATEGORY_HATE_SPEECH',
        threshold: 'BLOCK_ONLY_HIGH'
      },
      {
        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        threshold: 'BLOCK_ONLY_HIGH'
      },
      {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'BLOCK_ONLY_HIGH'
      }
    ];

    // Process chapters in batches
    for (let i = 0; i < data.chapters.length; i++) {
      try {
        const chapter = data.chapters[i];
        
        // Add context to help the safety evaluation
        const context = "This is a literary novel translation. The content is for creative writing purposes only.";
        
        const titlePrompt = `${context} Translate this Chinese novel chapter title to English: "${chapter.title}"`;
        const titleResult = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: titlePrompt }]}],
          safetySettings
        });
        const translatedTitle = (await titleResult.response.text()).trim();
        
        // Process content in chunks
        const contentChunks = chunkContent(chapter.content, 1500);
        let translatedContent = '';
        
        for (const chunk of contentChunks) {
          const contentPrompt = `${context} Translate this Chinese novel content to English. Keep original formatting:\n\n${chunk}`;
          const contentResult = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: contentPrompt }]}],
            safetySettings
          });
          translatedContent += (await contentResult.response.text()).trim() + "\n";
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        translatedChapters.push({
          title: translatedTitle,
          content: translatedContent.trim()
        });
        
        console.log(`Translated chapter ${i+1}/${data.chapters.length}`);
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 5000));
        
      } catch (error) {
        console.error(`Error on chapter ${i+1}:`, error.message);
        translatedChapters.push({
          title: `[Translation Error] ${data.chapters[i].title}`,
          content: `[Could not translate this chapter due to content restrictions. Please translate manually.]`
        });
      }
    }
    
    // Save results
    const translatedFileName = filePath.replace('.json', '-gemini.json');
    await fs.writeJson(translatedFileName, { chapters: translatedChapters }, { spaces: 2 });
    
  } catch (error) {
    console.error('Translation failed:', error);
    throw error;
  }
}

// Helper: Detects if UTF-8 decoding produced malformed characters
function containsMalformedUTF8(text) {
  return /�/.test(text); // Checks for replacement character (�)
}

// Get file names from command line arguments
const selectedFiles = process.argv.slice(2);
processFiles(selectedFiles);
