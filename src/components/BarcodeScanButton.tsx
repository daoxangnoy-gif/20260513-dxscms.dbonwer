import { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ScanLine, X, Loader2 } from "lucide-react";

// ปุ่มสแกนบาร์โค้ดด้วยกล้อง (ใช้ BarcodeDetector API — รองรับ Chrome บน Android)
// onScan(code) จะถูกเรียกเมื่อเจอบาร์โค้ด
export default function BarcodeScanButton({ onScan, className }: { onScan: (code: string) => void; className?: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const detectorRef = useRef<any>(null);

  const stop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = undefined;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };
  const close = () => { stop(); setOpen(false); };
  useEffect(() => () => stop(), []);

  const loop = async () => {
    const video = videoRef.current, detector = detectorRef.current;
    if (!video || !detector) return;
    try {
      const codes = await detector.detect(video);
      if (codes && codes.length) {
        const code = String(codes[0].rawValue || "").trim();
        if (code) {
          if (navigator.vibrate) navigator.vibrate(80);
          onScan(code);
          close();
          return;
        }
      }
    } catch { /* ข้าม error ราย frame */ }
    rafRef.current = requestAnimationFrame(loop);
  };

  const start = async () => {
    if (!("BarcodeDetector" in window)) {
      toast({ title: "อุปกรณ์นี้ไม่รองรับสแกนด้วยกล้อง", description: "ใช้ Chrome บน Android หรือยิง/คีย์บาร์โค้ดเข้าช่องแทน", variant: "destructive" });
      return;
    }
    setOpen(true);
    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      const Detector = (window as any).BarcodeDetector;
      detectorRef.current = new Detector({ formats: ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "itf", "codabar", "qr_code"] });
      setStarting(false);
      loop();
    } catch (e: any) {
      setStarting(false);
      close();
      toast({ title: "เปิดกล้องไม่สำเร็จ", description: e?.message || "ตรวจสิทธิ์กล้อง", variant: "destructive" });
    }
  };

  return (
    <>
      <Button type="button" size="sm" variant="outline" className={className} onClick={start} title="สแกนบาร์โค้ดด้วยกล้อง">
        <ScanLine className="w-4 h-4" />
      </Button>
      {open && (
        <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-4">
          <button onClick={close} className="absolute top-4 right-4 text-white p-2" aria-label="ปิด"><X className="w-6 h-6" /></button>
          <div className="relative">
            <video ref={videoRef} playsInline muted className="max-w-[92vw] max-h-[70vh] rounded-lg bg-black" />
            <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 h-28 border-2 border-emerald-400 rounded-lg pointer-events-none" />
          </div>
          <div className="text-white text-sm mt-4 flex items-center gap-2">
            {starting ? <><Loader2 className="w-4 h-4 animate-spin" /> กำลังเปิดกล้อง...</> : "เล็งบาร์โค้ดให้อยู่ในกรอบ"}
          </div>
        </div>
      )}
    </>
  );
}
