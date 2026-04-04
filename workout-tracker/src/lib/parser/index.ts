import { extractPdfText } from './pdfParser';
import { extractDocxText } from './docxParser';
import { extractExercises } from './exerciseExtractor';
import type { ParseResult } from '../../types/parser';

export async function parseWorkoutDocument(file: File): Promise<ParseResult> {
  let rawText = '';

  const ext = file.name.toLowerCase();
  if (ext.endsWith('.pdf')) {
    rawText = await extractPdfText(file);
  } else if (ext.endsWith('.docx') || ext.endsWith('.doc')) {
    rawText = await extractDocxText(file);
  } else {
    // Try as plain text
    rawText = await file.text();
  }

  return extractExercises(rawText);
}
