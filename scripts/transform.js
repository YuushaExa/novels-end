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
    
    // Process 10 chapters at a time
    for (let i = 0; i < data.chapters.length; i += 10) {
      const batch = data.chapters.slice(i, i + 10);
      
      try {
        // Translate chapter titles and content
        for (const chapter of batch) {
          const titlePrompt = `Translate this Chinese novel chapter title to English: "${chapter.title}"`;
          const contentPrompt = `Translate this Chinese novel chapter content to English. Keep the original formatting and line breaks:\n\n${chapter.content}`;
          
          // Translate title
          const titleResult = await model.generateContent(titlePrompt);
          chapter.translatedTitle = (await titleResult.response.text()).trim();
          
          // Translate content
          const contentResult = await model.generateContent(contentPrompt);
          chapter.translatedContent = (await contentResult.response.text()).trim();
          
          console.log(`Translated chapter: ${chapter.title}`);
        }
        
        // Add to results
        translatedChapters.push(...batch);
        
        // Wait 10 seconds between batches to avoid rate limits
        if (i + 10 < data.chapters.length) {
          console.log('Waiting 10 seconds before next batch...');
          await new Promise(resolve => setTimeout(resolve, 10000));
        }
      } catch (error) {
        console.error(`Error translating batch starting at chapter ${i + 1}:`, error);
        // Skip this batch but continue with next
        continue;
      }
    }
    
    // Save translated version
    const translatedFileName = filePath.replace('.json', '-gemini.json');
    await fs.writeJson(translatedFileName, { chapters: translatedChapters }, { spaces: 2 });
    console.log(`Saved translated version: ${path.basename(translatedFileName)}`);
    
  } catch (error) {
    console.error(`Error translating file ${path.basename(filePath)}:`, error);
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
