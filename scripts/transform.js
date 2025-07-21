const fs = require('fs-extra');
const path = require('path');
const unzipper = require('unzipper');
const iconv = require('iconv-lite'); // Added for better encoding support

async function processFiles(selectedFiles = []) {
  try {
    const dataDir = path.join(process.cwd(), 'data');
    const resultDir = path.join(process.cwd(), 'result');
    
    await fs.ensureDir(dataDir);
    await fs.ensureDir(resultDir);

    // Process ZIP files
    const zipFiles = (await fs.readdir(dataDir)).filter(file => file.endsWith('.zip'));
    for (const zipFile of zipFiles) {
      console.log(`Extracting ${zipFile}...`);
      const zipPath = path.join(dataDir, zipFile);
      const zipBaseName = path.basename(zipFile, '.zip');
      
      const tempExtractDir = path.join(dataDir, `temp_${zipBaseName}`);
      await fs.ensureDir(tempExtractDir);
      
      await fs.createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: tempExtractDir }))
        .promise();

      const extractedFiles = await fs.readdir(tempExtractDir);
      for (const extractedFile of extractedFiles) {
        if (extractedFile.endsWith('.txt')) {
          await fs.move(
            path.join(tempExtractDir, extractedFile),
            path.join(dataDir, extractedFile) // Keep original filename
          );
          console.log(`Extracted ${extractedFile}`);
        }
      }
      
      await fs.remove(tempExtractDir);
    }

    let allFiles = (await fs.readdir(dataDir)).filter(file => file.endsWith('.txt'));
    
    if (selectedFiles.length > 0) {
      const normalizedSelectedFiles = selectedFiles.map(file => 
        file.endsWith('.txt') ? file : `${file}.txt`
      );
      
      const files = allFiles.filter(file => normalizedSelectedFiles.includes(file));
      
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
    const outputFile = path.join(resultDir, `${path.basename(file, '.txt')}.json`);
    
    try {
      // Try UTF-8 first
      let content = await fs.readFile(filePath, 'utf8');
      
      if (containsMalformedUTF8(content)) {
        console.warn(`Falling back to GB18030 decoding for ${file}`);
        const buffer = await fs.readFile(filePath);
        content = iconv.decode(buffer, 'gb18030'); // Use proper Chinese encoding
      }

      const chapters = [];
      let currentChapter = null;
      
      const lines = content.split('\n');
      for (const line of lines) {
        if (line.match(/^第[零一二三四五六七八九十百千万\d]+章/)) { // Improved chapter detection
          if (currentChapter) chapters.push(currentChapter);
          currentChapter = { title: line.trim(), content: [] };
        } else if (currentChapter) {
          if (line.trim() || currentChapter.content.length > 0) {
            currentChapter.content.push(line);
          }
        }
      }
      
      if (currentChapter) chapters.push(currentChapter);
      
      // Clean chapter content
      chapters.forEach(chapter => {
        chapter.content = chapter.content.join('\n').trim();
        // Remove empty lines at start and end
        chapter.content = chapter.content.replace(/^\s*\n/, '').replace(/\n\s*$/, '');
      });

      // Only write if we have valid content
      if (chapters.length > 0) {
        await fs.writeJson(outputFile, { chapters }, { spaces: 2 });
        console.log(`Processed ${file} -> ${path.basename(outputFile)} (${chapters.length} chapters)`);
      } else {
        console.warn(`No chapters found in ${file}, skipping`);
      }
    } catch (error) {
      console.error(`Error processing ${file}:`, error);
    }
  }
}

function containsMalformedUTF8(text) {
  return /�/.test(text) || /[^\x00-\x7F]/.test(text) && !/[一-龯]/.test(text);
}

// Install required packages if missing
async function checkDependencies() {
  try {
    require.resolve('iconv-lite');
  } catch {
    console.log('Installing required dependencies...');
    const { execSync } = require('child_process');
    execSync('npm install iconv-lite', { stdio: 'inherit' });
  }
}

checkDependencies().then(() => {
  const selectedFiles = process.argv.slice(2);
  processFiles(selectedFiles);
});
