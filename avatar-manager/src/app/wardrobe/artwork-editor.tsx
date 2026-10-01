'use client';

import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { ArtworkStore } from '@/components/hamster/artwork';
import { placementKey } from '@/components/hamster/placements';
import type { PlacementTarget } from '@/components/hamster/placements';
import { colorHex, paintPixelStroke, pixelsEqual, samplePixel } from './pixel-tools';
import type { PixelColor, PixelPoint, PixelTool } from './pixel-tools';

interface ArtworkContext extends ArtworkStore { source: string; originalSha256: string; originalSrc: string; src: string }
const zoomLevels = [25, 50, 75, 100, 200, 400, 800, 1600];
const historyLimit = 20;
const queryFor = (target: PlacementTarget) => new URLSearchParams({ itemId: target.itemId, pose: target.pose, variant: target.variant, group: target.group, index: String(target.index) });
const cloneBitmap = (bitmap: ImageData) => new ImageData(new Uint8ClampedArray(bitmap.data), bitmap.width, bitmap.height);

export function ArtworkEditor({ target, label, onSaved, onClose }: {
  target: PlacementTarget; label: string; onSaved: (store: ArtworkStore) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const bitmap = useRef<ImageData | null>(null);
  const baseline = useRef<ImageData | null>(null);
  const undoStack = useRef<ImageData[]>([]), redoStack = useRef<ImageData[]>([]);
  const stroke = useRef<{ pointerId: number; previous: PixelPoint; before: ImageData; changed: boolean } | null>(null);
  const [context, setContext] = useState<ArtworkContext | null>(null);
  const [tool, setTool] = useState<PixelTool>('eraser');
  const [size, setSize] = useState(8);
  const [color, setColor] = useState('#90cda0');
  const [opacity, setOpacity] = useState(100);
  const [zoom, setZoom] = useState(50);
  const [cursor, setCursor] = useState<PixelPoint | null>(null);
  const [counts, setCounts] = useState({ undo: 0, redo: 0 });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const targetKey = placementKey(target);
  const fitZoom = () => Math.max(25, Math.floor(Math.min(viewport.current?.clientWidth ?? 500, viewport.current?.clientHeight ?? 500) / 1000 * 100) - 2);

  useEffect(() => {
    dialog.current?.showModal();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = oldOverflow; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/wardrobe/artwork?${queryFor(target)}`, { signal: controller.signal, cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? '의상을 불러오지 못했습니다.');
        const image = new Image();
        image.src = result.src;
        await image.decode();
        if (controller.signal.aborted) return;
        if (image.naturalWidth !== 1000 || image.naturalHeight !== 1000) throw new Error('1000×1000 PNG만 세부 작업할 수 있습니다.');
        const ctx = canvas.current?.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('이 브라우저에서 픽셀 편집을 사용할 수 없습니다.');
        ctx.clearRect(0, 0, 1000, 1000); ctx.drawImage(image, 0, 0);
        bitmap.current = ctx.getImageData(0, 0, 1000, 1000);
        baseline.current = cloneBitmap(bitmap.current);
        setContext(result);
        setZoom(fitZoom());
        setLoading(false);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setLoading(false); setError(true); setMessage(cause instanceof Error ? cause.message : '의상을 불러오지 못했습니다.');
      }
    }
    void load();
    return () => controller.abort();
  }, [targetKey]);
  useEffect(() => {
    if (!dirty) return;
    function warn(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ''; }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function updateHistory() {
    setCounts({ undo: undoStack.current.length, redo: redoStack.current.length });
    setDirty(!!bitmap.current && !!baseline.current && !pixelsEqual(bitmap.current.data, baseline.current.data));
  }
  function finishStroke() {
    if (!stroke.current) return;
    if (stroke.current.changed) {
      undoStack.current.push(stroke.current.before);
      if (undoStack.current.length > historyLimit) undoStack.current.shift();
      redoStack.current = [];
    }
    stroke.current = null; updateHistory();
  }
  function undo() {
    if (saving) return;
    finishStroke();
    const previous = undoStack.current.pop();
    if (!previous || !bitmap.current || saving) return;
    redoStack.current.push(bitmap.current); bitmap.current = previous;
    canvas.current!.getContext('2d')!.putImageData(previous, 0, 0); updateHistory();
  }
  function redo() {
    if (saving) return;
    const next = redoStack.current.pop();
    if (!next || !bitmap.current || saving) return;
    undoStack.current.push(bitmap.current); bitmap.current = next;
    canvas.current!.getContext('2d')!.putImageData(next, 0, 0); updateHistory();
  }
  function close() {
    if (saving) return;
    finishStroke();
    const unsaved = bitmap.current && baseline.current && !pixelsEqual(bitmap.current.data, baseline.current.data);
    if (unsaved && !window.confirm('저장하지 않은 픽셀 수정이 있습니다. 변경을 버리고 닫을까요?')) return;
    onClose();
  }
  function canvasPoint(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width * 1000, y: (event.clientY - rect.top) / rect.height * 1000 };
  }
  function ink(): PixelColor { return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16), Math.round(opacity / 100 * 255)]; }
  function draw(from: PixelPoint, to: PixelPoint) {
    if (!bitmap.current || tool === 'eyedropper') return;
    const area = paintPixelStroke(bitmap.current, from, to, size, tool, ink());
    if (area) {
      canvas.current!.getContext('2d')!.putImageData(bitmap.current, 0, 0, area.x, area.y, area.width, area.height);
      if (stroke.current) stroke.current.changed = true;
      setDirty(true); setMessage('');
    }
  }
  function start(event: PointerEvent<HTMLCanvasElement>) {
    if (saving || loading || !bitmap.current || !context || event.button !== 0) return;
    event.preventDefault();
    const point = canvasPoint(event); setCursor(point);
    if (tool === 'eyedropper') {
      const sampled = samplePixel(bitmap.current, point);
      if (!sampled || sampled[3] === 0) { setError(false); setMessage('투명한 픽셀입니다. 색이 있는 부분을 선택해 주세요.'); return; }
      setColor(colorHex(sampled)); setOpacity(Math.round(sampled[3] / 255 * 100)); setTool('pen');
      setError(false); setMessage(`${colorHex(sampled)} 색상을 선택했습니다.`); return;
    }
    finishStroke();
    event.currentTarget.setPointerCapture(event.pointerId);
    stroke.current = { pointerId: event.pointerId, previous: point, before: cloneBitmap(bitmap.current), changed: false };
    draw(point, point);
  }
  function move(event: PointerEvent<HTMLCanvasElement>) {
    const point = canvasPoint(event); setCursor(point);
    if (!stroke.current || stroke.current.pointerId !== event.pointerId || saving) return;
    draw(stroke.current.previous, point); stroke.current.previous = point;
  }
  function setView(next: number) {
    const value = Math.max(25, Math.min(1600, Math.round(next)));
    const area = viewport.current, rect = canvas.current?.getBoundingClientRect(), areaRect = area?.getBoundingClientRect();
    const center = rect && areaRect && area ? { x: (areaRect.left + area.clientWidth / 2 - rect.left) / rect.width * 1000, y: (areaRect.top + area.clientHeight / 2 - rect.top) / rect.height * 1000 } : null;
    setCursor(null); setZoom(value);
    if (center && area) requestAnimationFrame(() => { area.scrollLeft = center.x * value / 100 - area.clientWidth / 2; area.scrollTop = center.y * value / 100 - area.clientHeight / 2; });
  }
  async function save(reset = false) {
    finishStroke();
    if (!context || saving || (!dirty && !reset)) return;
    setSaving(true); setMessage(''); setError(false);
    try {
      const metadata = { target, revision: context.revision, source: context.source, originalSha256: context.originalSha256 };
      let response;
      if (reset) {
        response = await fetch('/api/wardrobe/artwork', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(metadata) });
      } else {
        const blob = await new Promise<Blob>((resolve, reject) => canvas.current!.toBlob(value => value ? resolve(value) : reject(new Error('PNG를 만들지 못했습니다.')), 'image/png'));
        const form = new FormData(); form.append('metadata', JSON.stringify(metadata)); form.append('png', blob, 'wardrobe.png');
        response = await fetch('/api/wardrobe/artwork', { method: 'PUT', body: form });
      }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? '픽셀 수정 저장에 실패했습니다.');
      if (reset) {
        const image = new Image(); image.src = result.src; await image.decode();
        const ctx = canvas.current!.getContext('2d')!; ctx.clearRect(0, 0, 1000, 1000); ctx.drawImage(image, 0, 0);
        bitmap.current = ctx.getImageData(0, 0, 1000, 1000);
      }
      baseline.current = cloneBitmap(bitmap.current!);
      undoStack.current = []; redoStack.current = []; updateHistory();
      setContext({ ...context, ...result }); onSaved(result);
      setMessage(reset ? '가져온 원본 PNG로 복원했습니다. 배치 조정값은 유지됩니다.' : '의상 픽셀 수정을 저장했습니다. 착장 미리보기에도 적용됩니다.');
    } catch (cause) { setError(true); setMessage(cause instanceof Error ? cause.message : '저장에 실패했습니다.'); }
    finally { setSaving(false); }
  }

  return <dialog ref={dialog} className="artwork-dialog" aria-labelledby="artwork-title" onCancel={event => { event.preventDefault(); close(); }}
    onKeyDown={event => {
      if (saving || loading || ['INPUT', 'SELECT', 'TEXTAREA'].includes((event.target as HTMLElement).tagName)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      else if (event.ctrlKey && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
      else if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        const shortcuts: Record<string, PixelTool> = { p: 'pen', e: 'eraser', i: 'eyedropper' };
        if (shortcuts[event.key.toLowerCase()]) setTool(shortcuts[event.key.toLowerCase()]);
      }
    }}>
    <div className="artwork-shell"><header className="artwork-header"><div><div className="eyebrow">WARDROBE / PIXEL EDITOR</div><h2 id="artwork-title">의상 세부 작업</h2><p>{label}</p></div><button className="artwork-close" onClick={close} disabled={saving} aria-label="의상 세부 작업 닫기">×</button></header>
      <fieldset className="artwork-tools" disabled={saving || loading || !context}><legend className="visually-hidden">픽셀 편집 도구</legend>
        <div className="pixel-tool-picker" aria-label="편집 도구">{([['pen', '펜', 'P'], ['eraser', '지우개', 'E'], ['eyedropper', '스포이드', 'I']] as const).map(([id, name, shortcut]) => <button key={id} aria-pressed={tool === id} onClick={() => setTool(id)}><span>{name}</span><kbd>{shortcut}</kbd></button>)}</div>
        <div className="pixel-options"><label htmlFor="brush-size">도구 크기 <output>{size}px</output><div className="brush-size-inputs"><input id="brush-size" type="range" min="1" max="160" value={size} onChange={event => setSize(Number(event.target.value))} /><input type="number" aria-label="도구 크기 픽셀" min="1" max="160" value={size} onChange={event => { const next = event.target.valueAsNumber; if (Number.isFinite(next)) setSize(Math.max(1, Math.min(160, Math.round(next)))); }} /></div></label>
          <label className="pixel-color" htmlFor="brush-color">펜 색상<input id="brush-color" type="color" value={color} onChange={event => setColor(event.target.value)} /><code>{color.toUpperCase()}</code></label>
          <label className="pixel-opacity" htmlFor="brush-opacity">펜 불투명도 <output>{opacity}%</output><input id="brush-opacity" type="range" min="1" max="100" value={opacity} onChange={event => setOpacity(Number(event.target.value))} /></label></div>
      </fieldset>
      <div className="pixel-view-toolbar"><div className="pixel-history"><button className="secondary-button" disabled={!counts.undo || saving} onClick={undo}>실행 취소</button><button className="secondary-button" disabled={!counts.redo || saving} onClick={redo}>다시 실행</button></div>
        <div className="pixel-zoom"><button aria-label="축소" disabled={zoom <= 25} onClick={() => setView([...zoomLevels].reverse().find(value => value < zoom) ?? 25)}>−</button><label htmlFor="pixel-zoom" className="visually-hidden">작업 화면 확대</label><select id="pixel-zoom" value={zoom} onChange={event => setView(Number(event.target.value))}>{[...new Set([...zoomLevels, zoom])].sort((a, b) => a - b).map(value => <option key={value} value={value}>{value}%</option>)}</select><button aria-label="확대" disabled={zoom >= 1600} onClick={() => setView(zoomLevels.find(value => value > zoom) ?? 1600)}>+</button><button onClick={() => setView(fitZoom())}>화면 맞춤</button></div>
      </div>
      <p className={`pixel-message ${error ? 'error' : ''} ${message ? '' : 'empty'}`} role={error ? 'alert' : 'status'}>{message || '\u00a0'}</p>
      <div className="pixel-viewport" ref={viewport} data-testid="pixel-viewport"><div className="pixel-canvas-wrap" style={{ width: 1000 * zoom / 100, height: 1000 * zoom / 100 }}>
        <canvas ref={canvas} width="1000" height="1000" data-testid="pixel-canvas" aria-label="의상 픽셀 작업 영역" tabIndex={0}
          style={{ width: 1000 * zoom / 100, height: 1000 * zoom / 100 }} onPointerDown={start} onPointerMove={move}
          onPointerUp={finishStroke} onPointerCancel={finishStroke} onLostPointerCapture={finishStroke} onPointerLeave={() => { if (!stroke.current) setCursor(null); }} />
        {cursor && !loading && <span className={`pixel-brush-cursor ${tool}`} aria-hidden="true" style={{ left: (Math.floor(cursor.x) + .5) * zoom / 100, top: (Math.floor(cursor.y) + .5) * zoom / 100, width: tool === 'eyedropper' ? 18 : Math.max(2, size * zoom / 100), height: tool === 'eyedropper' ? 18 : Math.max(2, size * zoom / 100) }} />}
        {zoom >= 400 && <span className="pixel-grid-overlay" aria-hidden="true" style={{ backgroundSize: `${zoom / 100}px ${zoom / 100}px` }} />}
      </div>{loading && <div className="pixel-loading" role="status">의상 PNG를 불러오는 중…</div>}</div>
      <div className="pixel-status"><span>{dirty ? '저장 전 픽셀 변경 있음' : '픽셀 변경 모두 저장됨'}</span><span>{cursor ? `X ${Math.floor(cursor.x)} · Y ${Math.floor(cursor.y)}` : '1000 × 1000 PNG'}</span></div>
      <p className="pixel-help">지우개는 선택한 부분을 투명하게 지웁니다. 스포이드로 색을 선택하면 펜으로 전환됩니다. 400% 이상 확대하면 픽셀 격자가 보입니다. ⌘/Ctrl + Z로 실행 취소할 수 있습니다.</p>
      <footer className="artwork-footer"><button className="secondary-button" disabled={!context || saving || loading} onClick={() => { if ((!dirty || window.confirm('저장 전 픽셀 변경을 버리고 원본으로 복원할까요?'))) void save(true); }}>원본 PNG로 복원</button><div><button className="secondary-button" disabled={saving} onClick={close}>닫기</button><button className="primary-button" disabled={!dirty || saving || loading || !context} onClick={() => void save()}>{saving ? '저장 중…' : '픽셀 수정 저장'}</button></div></footer>
    </div>
  </dialog>;
}
