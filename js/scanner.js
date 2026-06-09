// scanner.js — OCR (Tesseract.js) & PDF (PDF.js) Wrapper
// Handles file type detection, validation, and text extraction.
// Improved: Better PDF text reconstruction, page-by-page processing, memory management.

(function () {
  'use strict';

  window.CalScan = window.CalScan || {};

  // ─── Constants ────────────────────────────────────────────

  const SUPPORTED_IMAGE_TYPES = [
    'image/jpeg', 'image/png', 'image/gif',
    'image/bmp', 'image/webp', 'image/tiff'
  ];

  const SUPPORTED_PDF_TYPES = ['application/pdf'];

  const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif'];
  const PDF_EXTENSIONS = ['.pdf'];

  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB for large PDFs

  // ─── File Detection & Validation ──────────────────────────

  function detectFileType(file) {
    if (SUPPORTED_IMAGE_TYPES.includes(file.type)) return 'image';
    if (SUPPORTED_PDF_TYPES.includes(file.type)) return 'pdf';

    const name = (file.name || '').toLowerCase();
    if (IMAGE_EXTENSIONS.some(ext => name.endsWith(ext))) return 'image';
    if (PDF_EXTENSIONS.some(ext => name.endsWith(ext))) return 'pdf';

    throw new Error(`Unsupported file type: ${file.type || 'unknown'}. Please upload an image or PDF.`);
  }

  function validateFile(file) {
    if (!file) return { valid: false, error: 'No file provided' };

    if (file.size > MAX_FILE_SIZE) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      return { valid: false, error: `File too large (${sizeMB}MB). Maximum size is 50MB.` };
    }

    if (file.size === 0) return { valid: false, error: 'File is empty' };

    try {
      detectFileType(file);
    } catch (e) {
      return { valid: false, error: e.message };
    }

    return { valid: true };
  }

  // ─── Image OCR ────────────────────────────────────────────

  async function extractFromImage(file, onProgress) {
    if (typeof Tesseract === 'undefined') {
      throw new Error('Tesseract.js is not loaded. Please check your internet connection and refresh.');
    }

    onProgress(5, 'Initializing OCR engine...');

    const worker = await Tesseract.createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          const percent = Math.round(m.progress * 100);
          onProgress(percent, 'Recognizing text...');
        } else if (m.status === 'loading language traineddata') {
          onProgress(3, 'Loading language data...');
        }
      }
    });

    try {
      onProgress(10, 'Scanning image...');
      const { data } = await worker.recognize(file);

      return {
        text: data.text || '',
        confidence: data.confidence || 0,
        source: 'ocr'
      };
    } finally {
      await worker.terminate();
    }
  }

  // ─── PDF Text Extraction (Improved) ───────────────────────

  /**
   * Reconstruct readable text from PDF.js text content items.
   * Uses item positions to properly detect line breaks and word spacing.
   */
  function reconstructText(textContent) {
    const items = textContent.items;
    if (!items || items.length === 0) return '';

    const lines = [];
    let currentLine = [];
    let lastY = null;
    let lastEndX = null;

    for (const item of items) {
      if (!item.str && item.str !== '') continue;

      // item.transform = [scaleX, skewX, skewY, scaleY, translateX, translateY]
      const x = item.transform ? item.transform[4] : 0;
      const y = item.transform ? item.transform[5] : 0;
      const fontSize = item.transform ? Math.abs(item.transform[0]) : 12;

      // Detect new line (Y position changed significantly)
      if (lastY !== null && Math.abs(y - lastY) > fontSize * 0.3) {
        // Flush current line
        if (currentLine.length > 0) {
          lines.push(currentLine.join(''));
          currentLine = [];
        }
        lastEndX = null;
      }

      // Detect word gap (X position jumped)
      if (lastEndX !== null && currentLine.length > 0) {
        const gap = x - lastEndX;
        if (gap > fontSize * 0.25) {
          currentLine.push(' ');
        }
      }

      currentLine.push(item.str);
      lastY = y;
      lastEndX = x + (item.width || item.str.length * fontSize * 0.5);
    }

    // Flush last line
    if (currentLine.length > 0) {
      lines.push(currentLine.join(''));
    }

    return lines.join('\n');
  }

  /**
   * Extract text from a PDF with improved handling for large files
   */
  async function extractFromPDF(file, onProgress) {
    // Wait for PDF.js to be ready
    if (typeof pdfjsLib === 'undefined') {
      if (window.__libsReady) {
        await window.__libsReady;
      }
      if (typeof pdfjsLib === 'undefined') {
        throw new Error('PDF.js is not loaded. Please check your internet connection and refresh.');
      }
    }

    onProgress(2, 'Loading PDF...');

    const arrayBuffer = await file.arrayBuffer();
    
    let pdf;
    try {
      pdf = await pdfjsLib.getDocument({ 
        data: arrayBuffer,
        useSystemFonts: true
      }).promise;
    } catch (e) {
      throw new Error('Failed to parse PDF file. It may be corrupted or password-protected.');
    }

    const totalPages = pdf.numPages;
    onProgress(5, `PDF loaded — ${totalPages} page${totalPages > 1 ? 's' : ''}`);

    let fullText = '';
    let usedOCR = false;
    let pagesProcessed = 0;

    for (let i = 1; i <= totalPages; i++) {
      const pagePercent = 5 + Math.round((i / totalPages) * 90);
      onProgress(pagePercent, `Processing page ${i} of ${totalPages}...`);

      try {
        const page = await pdf.getPage(i);

        // Extract text content
        const textContent = await page.getTextContent();
        
        // Use improved text reconstruction
        let pageText = reconstructText(textContent);

        // Also try simple concatenation as fallback comparison
        if (!pageText || pageText.trim().length < 10) {
          const simpleText = textContent.items
            .map(item => item.str)
            .join(' ')
            .replace(/\s{2,}/g, ' ')
            .trim();
          
          if (simpleText.length > pageText.trim().length) {
            pageText = simpleText;
          }
        }

        if (pageText && pageText.trim().length > 10) {
          // Digital text found
          fullText += `--- Page ${i} ---\n${pageText.trim()}\n\n`;
        } else {
          // Scanned page — try OCR if Tesseract is available
          if (typeof Tesseract !== 'undefined') {
            usedOCR = true;
            onProgress(pagePercent, `OCR scanning page ${i} of ${totalPages}...`);

            try {
              const ocrText = await ocrPDFPage(page);
              if (ocrText && ocrText.trim().length > 5) {
                fullText += `--- Page ${i} ---\n${ocrText.trim()}\n\n`;
              }
            } catch (ocrErr) {
              console.warn(`OCR failed for page ${i}:`, ocrErr);
            }
          }
        }

        pagesProcessed++;
      } catch (pageErr) {
        console.warn(`Error processing page ${i}:`, pageErr);
        // Continue with other pages
      }
    }

    return {
      text: fullText.trim(),
      pageCount: totalPages,
      pagesProcessed: pagesProcessed,
      source: usedOCR ? 'pdf+ocr' : 'pdf'
    };
  }

  /**
   * OCR a single PDF page by rendering it to canvas
   */
  async function ocrPDFPage(page) {
    if (typeof Tesseract === 'undefined') return '';

    const scale = 2;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: ctx,
      viewport: viewport
    }).promise;

    const worker = await Tesseract.createWorker('eng');
    try {
      const { data } = await worker.recognize(canvas);
      return data.text || '';
    } finally {
      await worker.terminate();
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  // ─── Unified Scanner ──────────────────────────────────────

  async function scan(file, onProgress) {
    const progressCb = onProgress || (() => { });

    const validation = validateFile(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Ensure libraries are loaded
    if (window.__libsReady) {
      progressCb(1, 'Loading libraries...');
      await window.__libsReady;
    }

    const fileType = detectFileType(file);
    let result;

    if (fileType === 'image') {
      const imgResult = await extractFromImage(file, progressCb);
      result = {
        text: imgResult.text,
        source: imgResult.source,
        metadata: {
          type: 'image',
          confidence: imgResult.confidence,
          fileName: file.name,
          fileSize: file.size
        }
      };
    } else if (fileType === 'pdf') {
      const pdfResult = await extractFromPDF(file, progressCb);
      result = {
        text: pdfResult.text,
        source: pdfResult.source,
        metadata: {
          type: 'pdf',
          pageCount: pdfResult.pageCount,
          pagesProcessed: pdfResult.pagesProcessed,
          fileName: file.name,
          fileSize: file.size
        }
      };
    }

    progressCb(100, 'Scan complete');
    console.log(`📄 Extracted ${result.text.length} characters from ${fileType} (source: ${result.source})`);

    return result;
  }

  // ─── Export ───────────────────────────────────────────────

  window.CalScan.Scanner = {
    scan,
    validateFile,
    detectFileType,
    SUPPORTED_IMAGE_TYPES,
    SUPPORTED_PDF_TYPES
  };

})();
