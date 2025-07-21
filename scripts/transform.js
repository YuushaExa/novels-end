const fs = require('fs-extra');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// Constants
const CHUNK_SIZE = 2000; // Optimal for Gemini Flash
const CHAPTER_DELAY = 3000; // ms between chapters
const CHUNK_DELAY = 1000; // ms between chunks
const MAX_RETRIES = 3;

// Initialize Gemini with safety settings
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GEMINI_FLASH_API_KEY);
const modelConfig = {
  model: "gemini-2.5-flash",
  safetySettings: [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
  ],
};
const model = genAI.getGenerativeModel(modelConfig);

async function processFiles(selectedFiles = []) {
  try {
    const dataDir = path.join(process.cwd(), 'data');
    const resultDir = path.join(process.cwd(), 'result');
    
    await fs.ensureDir(resultDir);
    let files = (await fs.readdir(dataDir))
      .filter(file => file.endsWith('.txt'))
      .filter(file => selectedFiles.length === 0 || selectedFiles.includes(file));
    
    if (files.length === 0) {
      console.log('No matching files found in data directory.');
      return;
    }

    await processFilesInBatches(files, dataDir, resultDir);
    console.log('All selected files processed and translated successfully!');
  } catch (error) {
    console.error('Error processing files:', error);
    process.exit(1);
  }
}

async function processFilesInBatches(files, dataDir, resultDir, batchSize = 2) {
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    await Promise.all(batch.map(file => processSingleFile(file, dataDir, resultDir)));
  }
}

async function processSingleFile(file, dataDir, resultDir) {
  try {
    const filePath = path.join(dataDir, file);
    const content = await readFileWithFallback(filePath);
    const chapters = extractChapters(content);
    
    const outputFile = path.join(resultDir, `${path.basename(file, '.txt')}.json`);
    await fs.writeJson(outputFile, { chapters }, { spaces: 2 });
    console.log(`Processed ${file} -> ${path.basename(outputFile)}`);
    
    await translateJsonFile(outputFile);
  } catch (error) {
    console.error(`Error processing file ${file}:`, error);
  }
}

async function readFileWithFallback(filePath) {
  try {
    // Try UTF-8 first
    let content = await fs.readFile(filePath, 'utf8');
    if (!containsMalformedUTF8(content)) return content;
    
    // Fallback to binary if UTF-8 fails
    console.warn(`Falling back to binary decoding for ${path.basename(filePath)}`);
    const buffer = await fs.readFile(filePath);
    return buffer.toString('binary');
  } catch (error) {
    console.error(`Error reading file ${path.basename(filePath)}:`, error);
    throw error;
  }
}

function extractChapters(content) {
  const chapters = [];
  const lines = content.split('\n');
  let currentChapter = null;
  
  for (const line of lines) {
    if (line.match(/^第\d+章/)) {
      if (currentChapter) {
        currentChapter.content = currentChapter.content.join('\n').trim();
        chapters.push(currentChapter);
      }
      currentChapter = { title: line.trim(), content: [] };
    } else if (currentChapter) {
      if (line.trim() || currentChapter.content.length > 0) {
        currentChapter.content.push(line);
      }
    }
  }
  
  if (currentChapter) {
    currentChapter.content = currentChapter.content.join('\n').trim();
    chapters.push(currentChapter);
  }
  
  return chapters;
}

async function translateJsonFile(filePath) {
  try {
    const data = await fs.readJson(filePath);
    const translatedChapters = [];
    
    for (let i = 0; i < data.chapters.length; i++) {
      const chapter = data.chapters[i];
      const result = await translateChapterWithRetry(chapter, i, data.chapters.length);
      translatedChapters.push(result);
      
      if (i < data.chapters.length - 1) {
        await new Promise(resolve => setTimeout(resolve, CHAPTER_DELAY));
      }
    }
    
    const translatedFileName = filePath.replace('.json', '-gemini.json');
    await fs.writeJson(translatedFileName, { chapters: translatedChapters }, { spaces: 2 });
    
  } catch (error) {
    console.error(`Fatal error translating file ${path.basename(filePath)}:`, error);
  }
}

async function translateChapterWithRetry(chapter, index, total) {
  let retries = 0;
  
  while (retries < MAX_RETRIES) {
    try {
      const [title, content] = await Promise.all([
        translateText(chapter.title, `chapter title ${index + 1}/${total}`),
        translateContent(chapter.content, `chapter content ${index + 1}/${total}`)
      ]);
      
      return { title, content };
      
    } catch (error) {
      retries++;
      console.error(`Attempt ${retries} failed for chapter ${index + 1}:`, error.message);
      
      if (retries >= MAX_RETRIES) {
        console.error(`Max retries reached for chapter ${index + 1}, using fallback`);
        return {
          title: `[Translation Failed] ${chapter.title}`,
          content: `[Content translation failed after ${MAX_RETRIES} attempts]`
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, CHAPTER_DELAY * retries));
    }
  }
}

async function translateContent(content, context) {
  const chunks = chunkContent(content, CHUNK_SIZE);
  let translatedContent = "";
  
  for (let i = 0; i < chunks.length; i++) {
    try {
      const result = await translateText(chunks[i], `${context}, chunk ${i + 1}/${chunks.length}`);
      translatedContent += result + "\n";
      
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY));
      }
    } catch (error) {
      console.error(`Error translating chunk ${i + 1} of ${context}:`, error);
      translatedContent += `[Translation failed for this chunk]`;
    }
  }
  
  return translatedContent.trim();
}

async function translateText(text, context) {
  const prompt = `Translate this Chinese novel text to English exactly. Maintain original meaning and formatting. Return only the translation:\n\n${text}`;
  const result = await model.generateContent(prompt);
  return (await result.response.text()).trim();
}

function chunkContent(text, maxLength) {
  const chunks = [];
  let currentChunk = "";
  const paragraphs = text.split('\n');
  
  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length > maxLength && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = "";
    }
    currentChunk += (currentChunk.length > 0 ? '\n' : '') + paragraph;
  }
  
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  
  return chunks;
}

function containsMalformedUTF8(text) {
  return /�/.test(text);
}

// Main execution
const selectedFiles = process.argv.slice(2);
processFiles(selectedFiles);
