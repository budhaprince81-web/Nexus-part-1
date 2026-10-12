import React, { useState, useRef, useCallback } from 'react';
import { CyberPanel, CyberButton, CyberBadge } from '@/components/ui/cyber';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Upload, Eye, FileText, Monitor, Search, Cpu, X, ZoomIn, Layers } from 'lucide-react';
import { ThinkingIndicator } from '@/components/hud/thinking';
import { useAnalyzeVision } from '@workspace/api-client-react';

type VisionMode = 'describe' | 'ocr' | 'detect_ui' | 'document' | 'screen_read' | 'custom';

interface VisionResult {
  id: string;
  description: string;
  objects: string[];
  extractedText: string | null;
  confidence: number;
  insights: string;
  mode: string;
  createdAt: string;
}

const MODES: { key: VisionMode; label: string; icon: React.ReactNode; desc: string; color: string }[] = [
  { key: 'describe',   label: 'Describe',   icon: <Eye className="w-4 h-4" />,     desc: 'Detailed image description + object detection', color: 'text-primary border-primary/40' },
  { key: 'ocr',        label: 'OCR',         icon: <FileText className="w-4 h-4" />,desc: 'Extract all text from image with precision',     color: 'text-emerald-400 border-emerald-400/40' },
  { key: 'detect_ui',  label: 'UI Detect',   icon: <Layers className="w-4 h-4" />,  desc: 'Identify UI elements for automation',            color: 'text-violet-400 border-violet-400/40' },
  { key: 'document',   label: 'Document',    icon: <FileText className="w-4 h-4" />,desc: 'Analyze documents and extract key data',         color: 'text-amber-400 border-amber-400/40' },
  { key: 'screen_read',label: 'Screen Read', icon: <Monitor className="w-4 h-4" />, desc: 'Read screen content and suggest automation',     color: 'text-cyan-300 border-cyan-300/40' },
  { key: 'custom',     label: 'Custom',      icon: <Search className="w-4 h-4" />,  desc: 'Ask anything about the image',                   color: 'text-pink-400 border-pink-400/40' },
];

export default function Vision() {
  const [mode, setMode] = useState<VisionMode>('describe');
  const [customPrompt, setCustomPrompt] = useState('');
  const [imageData, setImageData] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'>('image/jpeg');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const analyzeVision = useAnalyzeVision();

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const [header, data] = dataUrl.split(',');
      const mime = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
      setImageData(data);
      setImageMime(mime as any);
      setImagePreview(dataUrl);
      setResult(null);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleFile(file);
  }, [handleFile]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraActive(true);
    } catch (e) {
      alert('Camera access denied or unavailable.');
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    setCameraActive(false);
  };

  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const [, data] = dataUrl.split(',');
    setImageData(data);
    setImageMime('image/jpeg');
    setImagePreview(dataUrl);
    setResult(null);
    stopCamera();
  };

  const handleAnalyze = () => {
    if (!imageData) return;
    analyzeVision.mutate(
      {
        data: {
          imageBase64: imageData,
          mimeType: imageMime,
          prompt: mode === 'custom' ? customPrompt : undefined,
          mode,
        } as any
      },
      {
        onSuccess: (data: any) => setResult(data),
      }
    );
  };

  const selectedMode = MODES.find(m => m.key === mode)!;

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Header */}
      <CyberPanel className="shrink-0 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="flex items-center gap-3">
          <Eye className="w-7 h-7 text-primary" />
          <div>
            <h2 className="font-mono text-lg text-primary tracking-widest uppercase">Vision Agent</h2>
            <p className="font-mono text-[10px] text-primary/50 uppercase">Camera · OCR · Document · Screen Understanding</p>
          </div>
        </div>
      </CyberPanel>

      {/* Mode selector */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 shrink-0">
        {MODES.map(m => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className={`border p-2 flex flex-col items-center gap-1 transition-all text-center ${
              mode === m.key
                ? `${m.color} bg-primary/10 shadow-[0_0_12px_rgba(0,212,255,0.2)]`
                : 'border-primary/10 text-primary/40 hover:border-primary/30 hover:text-primary/70'
            }`}
          >
            <div className="flex items-center justify-center">{m.icon}</div>
            <span className="font-mono text-[9px] uppercase tracking-wider">{m.label}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0">
        {/* Input panel */}
        <CyberPanel className="flex flex-col gap-4 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-primary/20 pb-2 shrink-0">
            <Cpu className="w-4 h-4 text-primary" />
            <span className="font-mono text-xs uppercase tracking-widest text-primary">{selectedMode.label} Mode</span>
            <span className="text-[10px] text-primary/40 font-mono ml-auto">{selectedMode.desc}</span>
          </div>

          {/* Image input area */}
          {!cameraActive ? (
            <div
              className="flex-1 border-2 border-dashed border-primary/20 hover:border-primary/50 transition-colors flex flex-col items-center justify-center gap-4 cursor-pointer relative overflow-hidden"
              onClick={() => !imagePreview && fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
            >
              {imagePreview ? (
                <>
                  <img src={imagePreview} alt="Input" className="max-h-full max-w-full object-contain" />
                  <button
                    onClick={e => { e.stopPropagation(); setImagePreview(null); setImageData(null); setResult(null); }}
                    className="absolute top-2 right-2 w-6 h-6 bg-destructive/20 border border-destructive/50 text-destructive flex items-center justify-center hover:bg-destructive/40 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </>
              ) : (
                <div className="flex flex-col items-center gap-4 text-primary/40">
                  <div className="relative">
                    <Upload className="w-12 h-12" />
                    <motion.div
                      className="absolute inset-0"
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      <Upload className="w-12 h-12 text-primary/20" />
                    </motion.div>
                  </div>
                  <div className="text-center font-mono text-xs uppercase tracking-wider">
                    <div>Drop image here</div>
                    <div className="text-primary/30 text-[10px] mt-1">or click to browse</div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 relative bg-black">
              <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
              {/* Scanning overlay */}
              <div className="absolute inset-0 pointer-events-none">
                <motion.div
                  className="absolute left-0 right-0 h-0.5 bg-primary/60"
                  style={{ boxShadow: '0 0 10px rgba(0,212,255,0.8)' }}
                  animate={{ top: ['0%', '100%', '0%'] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                />
                {/* Corner brackets */}
                {['top-4 left-4', 'top-4 right-4', 'bottom-4 left-4', 'bottom-4 right-4'].map((pos, i) => (
                  <div key={i} className={`absolute ${pos} w-8 h-8`}
                    style={{
                      borderTop: i < 2 ? '2px solid rgba(0,212,255,0.8)' : 'none',
                      borderBottom: i >= 2 ? '2px solid rgba(0,212,255,0.8)' : 'none',
                      borderLeft: i % 2 === 0 ? '2px solid rgba(0,212,255,0.8)' : 'none',
                      borderRight: i % 2 === 1 ? '2px solid rgba(0,212,255,0.8)' : 'none',
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Hidden canvas for capture */}
          <canvas ref={canvasRef} className="hidden" />
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />

          {/* Custom prompt */}
          {mode === 'custom' && (
            <input
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              placeholder="What do you want to know about this image?"
              className="w-full bg-background/50 border border-primary/20 px-3 py-2 text-primary font-mono text-sm focus:outline-none focus:border-primary shrink-0"
            />
          )}

          {/* Actions */}
          <div className="flex gap-2 shrink-0">
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
            {!cameraActive ? (
              <>
                <CyberButton onClick={() => fileInputRef.current?.click()} className="flex-1 text-xs py-2">
                  <Upload className="w-4 h-4 mr-2" /> Upload
                </CyberButton>
                <CyberButton onClick={startCamera} className="flex-1 text-xs py-2">
                  <Camera className="w-4 h-4 mr-2" /> Camera
                </CyberButton>
              </>
            ) : (
              <>
                <CyberButton variant="success" onClick={captureFrame} className="flex-1 text-xs py-2">
                  <ZoomIn className="w-4 h-4 mr-2" /> Capture
                </CyberButton>
                <CyberButton variant="danger" onClick={stopCamera} className="flex-1 text-xs py-2">
                  <X className="w-4 h-4 mr-2" /> Cancel
                </CyberButton>
              </>
            )}
            <CyberButton
              onClick={handleAnalyze}
              disabled={!imageData || analyzeVision.isPending}
              className="flex-1 text-xs py-2"
              variant="primary"
            >
              <Eye className="w-4 h-4 mr-2" /> Analyze
            </CyberButton>
          </div>
        </CyberPanel>

        {/* Result panel */}
        <CyberPanel className="flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-primary/20 pb-2 shrink-0">
            <Eye className="w-4 h-4 text-primary" />
            <span className="font-mono text-xs uppercase tracking-widest text-primary">Analysis Output</span>
            {result && (
              <CyberBadge variant="success" className="ml-auto">{result.confidence}% confidence</CyberBadge>
            )}
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar relative">
            {analyzeVision.isPending && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm z-10">
                <ThinkingIndicator active size="lg" label="Vision Agent analyzing..." />
              </div>
            )}

            {!result && !analyzeVision.isPending && (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-primary/30 font-mono text-xs uppercase">
                <Eye className="w-10 h-10 opacity-20" />
                Upload an image and click Analyze
              </div>
            )}

            {result && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 flex flex-col gap-4 font-mono text-sm">
                {/* Description */}
                <div>
                  <div className="text-primary/50 text-[10px] uppercase tracking-widest mb-2">Description</div>
                  <div className="text-primary/90 text-xs leading-relaxed whitespace-pre-wrap border border-primary/10 p-3 bg-primary/3">
                    {result.description}
                  </div>
                </div>

                {/* Objects */}
                {result.objects.length > 0 && (
                  <div>
                    <div className="text-primary/50 text-[10px] uppercase tracking-widest mb-2">Detected Objects ({result.objects.length})</div>
                    <div className="flex flex-wrap gap-1.5">
                      {result.objects.map((obj, i) => (
                        <span key={i} className="text-[10px] border border-primary/30 bg-primary/5 px-2 py-0.5 text-primary/80 font-mono uppercase">{obj}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Extracted text */}
                {result.extractedText && (
                  <div>
                    <div className="text-primary/50 text-[10px] uppercase tracking-widest mb-2">Extracted Text</div>
                    <div className="text-emerald-400 text-xs leading-relaxed whitespace-pre-wrap border border-emerald-400/20 p-3 bg-emerald-400/3 max-h-40 overflow-y-auto custom-scrollbar">
                      {result.extractedText}
                    </div>
                  </div>
                )}

                {/* Insights */}
                {result.insights && (
                  <div>
                    <div className="text-primary/50 text-[10px] uppercase tracking-widest mb-2">AI Insights</div>
                    <div className="text-amber-400/80 text-xs leading-relaxed border border-amber-400/20 p-3 bg-amber-400/3">
                      {result.insights}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </div>
        </CyberPanel>
      </div>
    </div>
  );
}
