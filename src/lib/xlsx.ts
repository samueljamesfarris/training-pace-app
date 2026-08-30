/**
 * A minimal .xlsx writer, with no dependencies.
 *
 * The app precaches its whole bundle onto a phone, so pulling in a spreadsheet
 * library to write one file is the wrong trade — the smallest of them is
 * larger than everything else here put together. An xlsx is a zip of half a
 * dozen small XML parts, and zip allows entries to be *stored* rather than
 * deflated, so the whole format reduces to a CRC and some little-endian
 * headers. That is what this is.
 *
 * It writes only what this app needs: inline strings, numbers, a handful of
 * number formats, bold, column widths and a frozen header row. There is no
 * shared string table, no formulas and no charts.
 *
 * Pure — it takes a model and returns bytes, so the whole thing is testable
 * without a DOM. `history.ts` decides what goes in the sheets.
 */

/**
 * How a cell is displayed. The names say what the value *is*, not what it
 * looks like, because the point of writing xlsx rather than CSV is that a
 * duration is a duration: `duration` and `pace` are written as fractions of a
 * day, so a column of them sums and averages instead of being text that a
 * spreadsheet has to be argued with.
 */
export type CellStyle =
  | 'plain'
  | 'bold'
  | 'date'
  | 'duration'
  | 'pace'
  | 'distance'
  | 'delta'
  | 'boldDuration'
  | 'boldDistance'
  | 'boldPace';

/** Style ids, in the order `cellXfs` declares them below. */
const STYLE_ID: Record<CellStyle, number> = {
  plain: 0,
  bold: 1,
  duration: 2,
  pace: 3,
  distance: 4,
  delta: 5,
  boldDuration: 6,
  boldDistance: 7,
  boldPace: 8,
  date: 9,
};

export interface XlsxCell {
  /**
   * Absent means an empty cell, which is not the same claim as zero — an
   * indoor session's distance column has to stay genuinely blank so that a
   * spreadsheet summing it doesn't report a treadmill run as a ride that
   * covered no ground.
   */
  value?: string | number;
  style?: CellStyle;
}

export interface XlsxSheet {
  name: string;
  /** Column widths in Excel's character units. One per column. */
  widths: number[];
  /** Whether row 1 stays put when the rest scrolls. */
  freezeHeader: boolean;
  rows: XlsxCell[][];
}

/** Days between Excel's epoch (it thinks 1900 was a leap year) and Unix's. */
const EXCEL_EPOCH_OFFSET_DAYS = 25569;
const MS_PER_DAY = 86_400_000;
const SECONDS_PER_DAY = 86_400;

/**
 * An instant as an Excel date serial.
 *
 * Excel serials carry no timezone: the number *is* the wall-clock reading. So
 * the local offset is folded in, or a 6:12 AM ride exports as 13:12 for anyone
 * west of UTC, and the date on a pre-dawn workout lands on the wrong day.
 */
export function excelDate(ms: number): number {
  const offsetMs = new Date(ms).getTimezoneOffset() * 60_000;
  return (ms - offsetMs) / MS_PER_DAY + EXCEL_EPOCH_OFFSET_DAYS;
}

/** Seconds as a fraction of a day, which is how Excel stores a duration. */
export function excelDuration(seconds: number): number {
  return seconds / SECONDS_PER_DAY;
}

/**
 * XML has no escape at all for most control characters — a file containing one
 * is rejected outright rather than shown oddly — so they are dropped. A
 * workout name arrives from a shared link, which makes this untrusted input on
 * its way into a file someone opens.
 */
function escapeXml(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `A`, `B`, … `Z`, `AA`. */
export function columnName(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * Excel rejects a workbook whose sheet name carries any of `[]:*?/\`, is empty,
 * or runs past 31 characters — and rejects the whole file, not just the name.
 */
function sheetName(name: string): string {
  const cleaned = name
    .replace(/[[\]:*?/\\]/g, ' ')
    .trim()
    .slice(0, 31);
  return cleaned || 'Sheet';
}

function sheetXml(sheet: XlsxSheet): string {
  const view = sheet.freezeHeader
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';

  const cols = sheet.widths.length
    ? `<cols>${sheet.widths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';

  const rows = sheet.rows
    .map((cells, r) => {
      const body = cells
        .map((cell, c) => {
          const ref = `${columnName(c)}${r + 1}`;
          const s = cell.style ? ` s="${STYLE_ID[cell.style]}"` : '';
          // An absent value still gets a cell, so the column keeps its shape;
          // it simply carries nothing.
          if (cell.value == null) return `<c r="${ref}"${s}/>`;
          if (typeof cell.value === 'number') {
            if (!Number.isFinite(cell.value)) return `<c r="${ref}"${s}/>`;
            return `<c r="${ref}"${s}><v>${cell.value}</v></c>`;
          }
          return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(
            cell.value,
          )}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${body}</row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${view}${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

/**
 * `[h]:mm:ss` and `mm:ss` are elapsed-time formats: the brackets stop an hour
 * count rolling over at 24, and `mm` reads as minutes rather than months
 * because it sits beside `ss`. `+0;-0;0` gives the goal delta its sign back,
 * which a bare number format drops on the negative side.
 */
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="5">
<numFmt numFmtId="164" formatCode="[h]:mm:ss"/>
<numFmt numFmtId="165" formatCode="mm:ss"/>
<numFmt numFmtId="166" formatCode="0.000"/>
<numFmt numFmtId="167" formatCode="+0;-0;0"/>
<numFmt numFmtId="168" formatCode="yyyy-mm-dd\\ hh:mm"/>
</numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="166" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="168" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function parts(sheets: XlsxSheet[]): ZipEntry[] {
  const enc = new TextEncoder();
  const file = (name: string, text: string): ZipEntry => ({ name, bytes: enc.encode(text) });

  const overrides = sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('');

  // The styles relationship follows the sheets, so it takes the next id.
  const stylesRel = sheets.length + 1;

  return [
    file(
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ),
    file(
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    file(
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>${sheets
        .map(
          (s, i) =>
            `<sheet name="${escapeXml(sheetName(s.name))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
        )
        .join('')}</sheets></workbook>`,
    ),
    file(
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${
              i + 1
            }.xml"/>`,
        )
        .join(
          '',
        )}<Relationship Id="rId${stylesRel}" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`,
    ),
    file('xl/styles.xml', STYLES_XML),
    ...sheets.map((s, i) => file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s))),
  ];
}

/**
 * The workbook as a byte array, ready to become a Blob or be written to disk.
 *
 * The backing buffer is spelled out because `Blob` and `File` will not accept a
 * view that might be over shared memory, and an unannotated `Uint8Array` is.
 */
export function buildXlsx(sheets: XlsxSheet[], modifiedAt: number): Uint8Array<ArrayBuffer> {
  return zip(parts(sheets), modifiedAt);
}

// --- zip -------------------------------------------------------------------

interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * The instant as MS-DOS date and time fields.
 *
 * That format's epoch is 1980 and it has no room for anything earlier, so an
 * earlier instant is clamped rather than wrapped into a nonsense date.
 */
function dosStamp(ms: number): { time: number; date: number } {
  const d = new Date(ms);
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * A zip with every entry stored uncompressed.
 *
 * Deflate would mean carrying an entire compressor for a file that is already
 * only a few kilobytes of XML. Every reader accepts stored entries, so it
 * would buy nothing worth the code.
 */
function zip(entries: ZipEntry[], modifiedAt: number): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const stamp = dosStamp(modifiedAt);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = enc.encode(entry.name);
    const crc = crc32(entry.bytes);
    const size = entry.bytes.length;

    const local = new Uint8Array(30 + name.length + size);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, 0, true); // stored, not deflated
    lv.setUint16(10, stamp.time, true);
    lv.setUint16(12, stamp.date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // extra field length
    local.set(name, 30);
    local.set(entry.bytes, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, stamp.time, true);
    cv.setUint16(14, stamp.date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true); // where this entry's local header sits
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((a, b) => a + b.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const chunk of [...locals, ...centrals, end]) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
