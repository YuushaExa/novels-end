const fs = require('fs-extra');
const path = require('path');
const unzipper = require('unzipper');

async function processFiles(selectedFiles = []) {
  try {
    const dataDir = path.join(process.cwd(), 'data');
    const resultDir = path.join(process.cwd(), 'result');
    
    await fs.ensureDir(dataDir);
    await fs.ensureDir(resultDir);

    // First process ZIP files if any exist
    const zipFiles = (await fs.readdir(dataDir)).filter(file => file.endsWith('.zip'));
    for (const zipFile of zipFiles) {
      console.log(`Extracting ${zipFile}...`);
      const zipPath = path.join(dataDir, zipFile);
      const zipBaseName = path.basename(zipFile, '.zip');
      
      // Create a temporary directory for extraction
      const tempExtractDir = path.join(dataDir, `temp_${zipBaseName}`);
      await fs.ensureDir(tempExtractDir);
      
      // Extract to temporary directory
      await fs.createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: tempExtractDir }))
        .promise();

      // Rename and move extracted TXT files
      const extractedFiles = await fs.readdir(tempExtractDir);
      for (const extractedFile of extractedFiles) {
        if (extractedFile.endsWith('.txt')) {
          // Remove Chinese characters from filename but keep numbers and basic characters
          const cleanFileName = extractedFile.replace(/[^\w\d.-]/g, '');
          const newFileName = `${zipBaseName}_${cleanFileName}`;
          await fs.move(
            path.join(tempExtractDir, extractedFile),
            path.join(dataDir, newFileName)
          );
          console.log(`Renamed ${extractedFile} to ${newFileName}`);
        }
      }
      
      // Clean up temporary directory
      await fs.remove(tempExtractDir);
      console.log(`Finished processing ${zipFile}`);
    }

    let allFiles = (await fs.readdir(dataDir)).filter(file => file.endsWith('.txt'));
    
    // Filter files if specific files are selected
    if (selectedFiles.length > 0) {
      // Add .txt extension to input files if not present
      const normalizedSelectedFiles = selectedFiles.map(file => 
        file.endsWith('.txt') ? file : `${file}.txt`
      );
      
      const files = allFiles.filter(file => {
        // Compare both with and without Chinese characters in filenames
        const cleanFile = file.replace(/[^\w\d.-]/g, '');
        return normalizedSelectedFiles.includes(file) || 
               normalizedSelectedFiles.includes(cleanFile);
      });
      
      if (files.length === 0) {
        console.log('No matching files found in data directory.');
        return;
      }
      
      console.log(`Processing selected files: ${files.join(', ')}`);
      await processFileSet(files, dataDir, resultDir);
    } else {
      console.log('Processing all files in data directory');
      await processFileSet(allFiles, dataDir, resultDir);
    }
    
    console.log('Processing completed successfully!');
  } catch (error) {
    console.error('Error processing files:', error);
    process.exit(1);
  }
}

async function processFileSet(files, dataDir, resultDir) {
  for (const file of files) {
    const filePath = path.join(dataDir, file);
    
    // Generate clean output filename (without Chinese characters)
    const cleanOutputName = file.replace(/[^\w\d.-]/g, '');
    
    // Read file as UTF-8 (default)
    let content = await fs.readFile(filePath, 'utf8');
    
    // (Optional) Fallback to binary if UTF-8 fails
    if (containsMalformedUTF8(content)) {
      console.warn(`Falling back to binary decoding for ${cleanOutputName}`);
      const buffer = await fs.readFile(filePath);
      content = buffer.toString('binary');
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
    
    const outputFile = path.join(resultDir, `${path.basename(cleanOutputName, '.txt')}.json`);
    await fs.writeJson(outputFile, { chapters }, { spaces: 2 });
    console.log(`Processed ${cleanOutputName} -> ${path.basename(outputFile)}`);
  }
}

function containsMalformedUTF8(text) {
  return /�/.test(text);
}

const selectedFiles = process.argv.slice(2);
processFiles(selectedFiles);
