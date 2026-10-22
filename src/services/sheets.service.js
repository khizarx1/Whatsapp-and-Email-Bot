import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';

const CSV_PATH = path.resolve('data/leads_crm_master.csv');
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || '1TRvAySecgQC0PdfNi5YDlJMas3WrdFyRtfPCoNrMOK8';

/**
 * Helper to get an authenticated Google Sheets client if Service Account is provided.
 */
function getGoogleSheetsClient() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!clientEmail || !privateKey) {
    return null; // Fallback to local CRM master file
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

/**
 * Parses a simple CSV line respecting quoted strings with commas.
 */
function parseCsvLine(text) {
  const result = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

/**
 * Converts a raw array of cells into a clean Lead object.
 */
function mapRowToLead(cells) {
  return {
    index: cells[0] || '',
    companyName: cells[1] || '',
    entity: cells[2] || '',
    country: cells[3] || '',
    city: cells[4] || '',
    website: cells[5] || '',
    googleMapsUrl: cells[6] || '',
    linkedInUrl: cells[7] || '',
    email: cells[8] || '',
    phone: cells[9] || '',
    services: cells[10] || '',
    clientPortal: cells[11] || '',
    crm: cells[12] || '',
    leadScore: cells[13] || '',
    status: cells[14] || '',
    notes: cells[15] || '',
  };
}

/**
 * Formats a Lead object back to a CSV row.
 */
function formatLeadToCsvRow(lead) {
  const fields = [
    lead.index,
    lead.companyName,
    lead.entity,
    lead.country,
    lead.city,
    lead.website,
    lead.googleMapsUrl,
    lead.linkedInUrl,
    lead.email,
    lead.phone,
    lead.services,
    lead.clientPortal,
    lead.crm,
    lead.leadScore,
    lead.status,
    lead.notes,
  ];

  return fields
    .map((val) => {
      const str = String(val || '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    })
    .join(',');
}

/**
 * Reads a single lead by row number (1-based sheet row index).
 */
export async function getLeadByRow(rowNumber) {
  const sheets = getGoogleSheetsClient();

  if (sheets) {
    const range = `Sheet1!A${rowNumber}:P${rowNumber}`;
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range,
    });
    const rows = resp.data.values;
    if (!rows || rows.length === 0) return null;
    return mapRowToLead(rows[0]);
  }

  // Fallback to local CSV dataset
  if (!fs.existsSync(CSV_PATH)) return null;
  const lines = fs.readFileSync(CSV_PATH, 'utf-8').split(/\r?\n/);
  const targetIndex = rowNumber - 1; // row 1 is header, row 2 is index 1

  if (targetIndex < 1 || targetIndex >= lines.length || !lines[targetIndex].trim()) {
    return null;
  }

  const cells = parseCsvLine(lines[targetIndex]);
  return mapRowToLead(cells);
}

/**
 * Returns a list of leads matching targetStatus.
 */
export async function getLeadsByStatus(targetStatus = 'Ready to Contact', limit = 10) {
  const sheets = getGoogleSheetsClient();
  const normalizedTarget = targetStatus.toLowerCase().trim();
  const matches = [];

  if (sheets) {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A2:P',
    });
    const rows = resp.data.values || [];
    for (let i = 0; i < rows.length; i++) {
      const lead = mapRowToLead(rows[i]);
      if ((lead.status || '').toLowerCase().trim() === normalizedTarget) {
        matches.push({ lead, rowNumber: i + 2 });
        if (matches.length >= limit) break;
      }
    }
    return matches;
  }

  // Fallback to local CSV
  if (!fs.existsSync(CSV_PATH)) return [];
  const lines = fs.readFileSync(CSV_PATH, 'utf-8').split(/\r?\n/);

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = parseCsvLine(lines[i]);
    const lead = mapRowToLead(cells);
    if ((lead.status || '').toLowerCase().trim() === normalizedTarget) {
      matches.push({ lead, rowNumber: i + 1 });
      if (matches.length >= limit) break;
    }
  }

  return matches;
}

/**
 * Updates a lead's Status (Col O) and Notes (Col P).
 */
export async function updateLeadStatus(rowNumber, newStatus, additionalNotes = '') {
  const sheets = getGoogleSheetsClient();

  if (sheets) {
    const range = `Sheet1!O${rowNumber}:P${rowNumber}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[newStatus, additionalNotes]],
      },
    });
    console.log(`[Google Sheets] Updated row ${rowNumber}: Status="${newStatus}"`);
    return true;
  }

  // Update local CSV
  if (!fs.existsSync(CSV_PATH)) return false;
  const lines = fs.readFileSync(CSV_PATH, 'utf-8').split(/\r?\n/);
  const targetIndex = rowNumber - 1;

  if (targetIndex < 1 || targetIndex >= lines.length) return false;

  const cells = parseCsvLine(lines[targetIndex]);
  const lead = mapRowToLead(cells);
  lead.status = newStatus;
  lead.notes = additionalNotes ? `${lead.notes || ''} | ${additionalNotes}` : lead.notes;

  lines[targetIndex] = formatLeadToCsvRow(lead);
  fs.writeFileSync(CSV_PATH, lines.join('\n'), 'utf-8');
  console.log(`[Local CRM] Updated row ${rowNumber}: Status="${newStatus}"`);
  return true;
}

/**
 * Finds lead by email address and marks status as 'Replied'.
 */
export async function markLeadAsReplied(senderEmail) {
  if (!senderEmail) return false;
  const normalizedEmail = senderEmail.toLowerCase().trim();

  // Look in local CSV or Sheet
  if (fs.existsSync(CSV_PATH)) {
    const lines = fs.readFileSync(CSV_PATH, 'utf-8').split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cells = parseCsvLine(lines[i]);
      const email = (cells[8] || '').toLowerCase().trim();

      if (email && (email === normalizedEmail || normalizedEmail.includes(email))) {
        const rowNumber = i + 1;
        const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
        await updateLeadStatus(rowNumber, 'Replied', `Received email reply on ${timestamp}`);
        console.log(`[CRM] Marked lead at row ${rowNumber} (${cells[1]}) as 'Replied'!`);
        return true;
      }
    }
  }

  return false;
}
