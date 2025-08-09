import { useCallback, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Tesseract from "tesseract.js";
import { differenceInCalendarDays, endOfMonth, parse, parseISO } from "date-fns";

type OCRDetails = {
  rawText: string;
  expiryDate?: Date;
  manufacturedDate?: Date;
  batch?: string;
  mrp?: string;
  productName?: string;
  labels: Record<string, string>;
};

const monthMap: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, SEPT: 8, OCT: 9, NOV: 10, DEC: 11,
};

function tryParseDate(text: string): Date | undefined {
  const candidates: Date[] = [];
  const tryFormats = (
    dateStr: string,
    fmts: string[],
    postProcess?: (d: Date) => Date
  ) => {
    for (const f of fmts) {
      try {
        const d = parse(dateStr, f, new Date());
        if (!isNaN(d.getTime())) {
          candidates.push(postProcess ? postProcess(d) : d);
        }
      } catch {}
    }
  };

  // yyyy-mm-dd or yyyy/mm/dd etc
  const isoLike = text.match(/(20\d{2})[\/.\-](0?[1-9]|1[0-2])[\/.\-]([0-2]?\d|3[01])/);
  if (isoLike) tryFormats(isoLike[0], ["yyyy-MM-dd", "yyyy/M/d", "yyyy.M.d", "yyyy-M-d", "yyyy/MM/dd"]);

  // dd-mm-yyyy, dd/mm/yy etc
  const dmy = text.match(/([0-2]?\d|3[01])[\/.\-](0?[1-9]|1[0-2])[\/.\-](\d{2,4})/);
  if (dmy) tryFormats(dmy[0], ["d-M-yyyy", "d-M-yy", "d/M/yyyy", "d/M/yy", "dd-MM-yyyy", "dd/MM/yyyy", "dd.MM.yyyy"]);

  // mm-dd-yyyy
  const mdy = text.match(/(0?[1-9]|1[0-2])[\/.\-]([0-2]?\d|3[01])[\/.\-](\d{2,4})/);
  if (mdy) tryFormats(mdy[0], ["M-d-yyyy", "M/d/yy", "M/d/yyyy", "MM-dd-yyyy", "MM/dd/yyyy"]);

  // 12 Jan 2026 or Jan 2026
  const monthWordFull = text.match(/\b(\d{1,2})?\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s*(\d{2,4})\b/i);
  if (monthWordFull) {
    const dayStr = monthWordFull[1];
    const mon = monthWordFull[2].toUpperCase().slice(0,3);
    const yearStr = monthWordFull[3];
    const year = parseInt(yearStr.length === 2 ? "20" + yearStr : yearStr, 10);
    const month = monthMap[mon];
    if (month !== undefined) {
      const day = dayStr ? parseInt(dayStr, 10) : 1;
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) candidates.push(d);
    }
  }

  // Best before Jan 2026 -> use end of that month
  const bestBeforeMonth = text.match(/best\s*before.*?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s*(\d{2,4})/i);
  if (bestBeforeMonth) {
    const mon = bestBeforeMonth[1].toUpperCase().slice(0,3);
    const yearStr = bestBeforeMonth[2];
    const year = parseInt(yearStr.length === 2 ? "20" + yearStr : yearStr, 10);
    const month = monthMap[mon];
    if (month !== undefined) {
      candidates.push(endOfMonth(new Date(year, month, 1)));
    }
  }

  // Generic ISO
  const iso = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (iso) {
    try {
      const d = parseISO(iso[0]);
      if (!isNaN(d.getTime())) candidates.push(d);
    } catch {}
  }

  return candidates.sort((a, b) => a.getTime() - b.getTime())[0];
}

function extractDetails(raw: string): OCRDetails {
  const text = raw.replace(/\s+/g, " ").trim();
  const upper = text.toUpperCase();

  let expiry: Date | undefined = undefined;

  // Prefer dates near EXP/EXPIRY/USE BY/BEST BEFORE labels
  const nearExpiry = upper.match(/(EXP(?:IRY|IRATION)?|USE\s*BY|BEST\s*BEFORE|BBE)[:\-\s]*([^\n]+)/i);
  if (nearExpiry && nearExpiry[2]) {
    expiry = tryParseDate(nearExpiry[2]);
  }
  if (!expiry) expiry = tryParseDate(upper);

  // Manufactured/MFD/MFG
  let manufactured: Date | undefined = undefined;
  const mfd = upper.match(/(MFD|MFG|MANUFACTURED)[^\d]*(.*?)(?=LOT|BATCH|EXP|USE|BEST|$)/);
  if (mfd && mfd[2]) manufactured = tryParseDate(mfd[2]);

  // Batch / Lot
  let batch: string | undefined;
  const batchMatch = upper.match(/(LOT|BATCH)[:\-\s]*([A-Z0-9\-]+)/);
  if (batchMatch) batch = batchMatch[2];

  // MRP / Price
  let mrp: string | undefined;
  const mrpMatch = text.match(/MRP[^\d]*([₹Rs\.]?\s*[\d.,]+)/i);
  if (mrpMatch) mrp = mrpMatch[1].replace(/\s+/g, "");

  // A naive product name: first longish non-keyword line
  let productName: string | undefined;
  const lines = raw.split(/\n|\r/).map(l => l.trim()).filter(Boolean);
  for (const l of lines) {
    const u = l.toUpperCase();
    if (u.length > 3 && !/(EXP|MFD|MFG|LOT|BATCH|BEST|BEFORE|USE|BY|MRP|DATE)/.test(u)) {
      productName = l;
      break;
    }
  }

  const labels: Record<string, string> = {};
  if (batch) labels["Batch/Lot"] = batch;
  if (mrp) labels["MRP"] = mrp;
  if (manufactured) labels["Manufactured"] = manufactured.toDateString();

  return { rawText: raw, expiryDate: expiry, manufacturedDate: manufactured, batch, mrp, productName, labels };
}

export default function ExpiryScanner() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<OCRDetails | null>(null);
  const [engine, setEngine] = useState<'vision' | 'tesseract'>(() => (localStorage.getItem('ocrEngine') as 'vision'|'tesseract') || (localStorage.getItem('gcvApiKey') ? 'vision' : 'tesseract'));
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem('gcvApiKey') || 'AIzaSyDFP57AKe55eqo_JUx0CVC7MK47ADykJPs');
  const containerRef = useRef<HTMLDivElement>(null);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    containerRef.current.style.setProperty("--spot-x", `${x}%`);
    containerRef.current.style.setProperty("--spot-y", `${y}%`);
  }, []);

const handleFile = async (file: File) => {
  setError(null);
  setDetails(null);
  const url = URL.createObjectURL(file);
  setImageUrl(url);
  setLoading(true);
  setProgress(0);

  const fileToBase64 = (f: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      resolve(res.split(",")[1] || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(f);
  });

  try {
    let text = "";
    if (engine === 'vision') {
      if (!apiKey) throw new Error('Missing Google Cloud Vision API key');
      setProgress(10);
      const base64 = await fileToBase64(file);
      const resp = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}` , {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              image: { content: base64 },
              features: [{ type: 'TEXT_DETECTION' }],
              imageContext: { languageHints: ['en'] }
            }
          ]
        })
      });
      if (!resp.ok) throw new Error('Vision API request failed');
      const data = await resp.json();
      text = data?.responses?.[0]?.fullTextAnnotation?.text || data?.responses?.[0]?.textAnnotations?.[0]?.description || "";
      setProgress(100);
    } else {
      const result = await Tesseract.recognize(url, "eng", {
        logger: (m) => {
          if (m.status === "recognizing text" && m.progress != null) {
            setProgress(Math.round(m.progress * 100));
          }
        },
      });
      text = result.data?.text || "";
    }

    const extracted = extractDetails(text);
    setDetails(extracted);
  } catch (err: any) {
    console.error(err);
    setError(err?.message || "Failed to process the image. Please try a clearer photo.");
  } finally {
    setLoading(false);
  }
};

  const status = useMemo(() => {
    if (!details?.expiryDate) return { label: "No expiry date detected", tone: "muted" as const };
    const now = new Date();
    const days = differenceInCalendarDays(details.expiryDate, now);
    if (days < 0) return { label: `Expired ${Math.abs(days)} day${Math.abs(days)===1?'':'s'} ago`, tone: "destructive" as const };
    if (days === 0) return { label: "Expires today", tone: "secondary" as const };
    return { label: `${days} day${days===1?'':'s'} left`, tone: "primary" as const };
  }, [details?.expiryDate]);

  return (
    <section className="w-full" aria-label="Expiry Date Scanner">
      <div
        ref={containerRef}
        onMouseMove={onMouseMove}
        className="ambient-spot rounded-2xl p-6 md:p-10"
      >
        <div className="mx-auto max-w-3xl">
          <Card className="card-elevated">
            <CardHeader>
              <CardTitle>Upload a label image</CardTitle>
              <CardDescription>We will extract the expiry date and other details automatically.</CardDescription>
            </CardHeader>
            <CardContent>
<div className="grid gap-4">
  <div className="grid gap-3 md:grid-cols-2">
    <div className="grid gap-2">
      <Label className="text-sm">OCR engine</Label>
      <Select value={engine} onValueChange={(v) => { setEngine(v as 'vision'|'tesseract'); localStorage.setItem('ocrEngine', v); }}>
        <SelectTrigger aria-label="Select OCR engine"><SelectValue placeholder="Select engine" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="vision">Google Vision (AI)</SelectItem>
          <SelectItem value="tesseract">Tesseract (offline)</SelectItem>
        </SelectContent>
      </Select>
    </div>
    {engine === 'vision' && (
      <div className="grid gap-2">
        <Label htmlFor="gcvKey" className="text-sm">Google Vision API key (stored locally)</Label>
        <Input
          id="gcvKey"
          type="password"
          placeholder="AIza..."
          value={apiKey}
          onChange={(e) => { setApiKey(e.target.value); localStorage.setItem('gcvApiKey', e.target.value); }}
        />
      </div>
    )}
  </div>

  <div className="grid gap-2">
    <label htmlFor="uploader" className="text-sm">Choose an image (JPG/PNG)</label>
    <Input
      id="uploader"
      type="file"
      accept="image/*"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) handleFile(f);
      }}
    />
  </div>
</div>

                {imageUrl && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border overflow-hidden">
                      <img
                        src={imageUrl}
                        alt="Uploaded product label preview"
                        className="w-full h-full object-contain bg-muted"
                        loading="lazy"
                      />
                    </div>

                    <div className="flex flex-col gap-3">
                      {loading && (
                        <div className="space-y-2">
                          <div className="text-sm text-muted-foreground">Running OCR… {progress}%</div>
                          <Progress value={progress} />
                        </div>
                      )}

                      {error && (
                        <div className="text-sm text-destructive">
                          {error}
                        </div>
                      )}

                      {details && (
                        <div className="space-y-3">
                          <div className="flex items-center gap-3">
                            <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium ${status.tone === 'destructive' ? 'border-destructive text-destructive' : status.tone === 'primary' ? 'border-primary text-primary' : status.tone === 'secondary' ? 'border-secondary text-foreground' : 'border-muted text-muted-foreground'}`}>{status.label}</span>
                            {details.expiryDate && (
                              <span className="text-sm text-muted-foreground">Expiry: {details.expiryDate.toDateString()}</span>
                            )}
                          </div>

                          {(details.productName || details.batch || details.mrp || details.manufacturedDate) && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                              {details.productName && (
                                <div className="rounded-md border p-2"><span className="text-muted-foreground">Product</span><div className="font-medium">{details.productName}</div></div>
                              )}
                              {details.batch && (
                                <div className="rounded-md border p-2"><span className="text-muted-foreground">Batch/Lot</span><div className="font-medium">{details.batch}</div></div>
                              )}
                              {details.mrp && (
                                <div className="rounded-md border p-2"><span className="text-muted-foreground">MRP</span><div className="font-medium">{details.mrp}</div></div>
                              )}
                              {details.manufacturedDate && (
                                <div className="rounded-md border p-2"><span className="text-muted-foreground">Manufactured</span><div className="font-medium">{details.manufacturedDate.toDateString()}</div></div>
                              )}
                            </div>
                          )}

                          <details className="rounded-md border p-3">
                            <summary className="cursor-pointer text-sm font-medium">View raw OCR text</summary>
                            <p className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap">{details.rawText}</p>
                          </details>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {!imageUrl && (
                  <div className="rounded-lg border border-dashed p-8 text-center">
                    <p className="text-sm text-muted-foreground mb-4">Drop an image here or click to upload</p>
                    <label htmlFor="uploader" className="inline-flex">
                      <Button variant="hero">Select Image</Button>
                    </label>
                  </div>
                )}
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
