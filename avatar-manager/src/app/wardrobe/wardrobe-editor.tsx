'use client';

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Hamster, POSES, applyPlacements, layerPlacement, placementKey, placementSource, registeredFrame, mergePlacementChanges, PLACEMENT_LIMITS } from '@/components/hamster';
import type { HamsterPose, HamsterVariant, ItemCatalog, LayerPlacement, PlacementChange, PlacementDocument, PlacementTarget } from '@/components/hamster';
import { applyArtwork } from '@/components/hamster/artwork';
import type { ArtworkStore } from '@/components/hamster/artwork';
import { PublishPanel } from './publish-panel';
import { ArtworkEditor } from './artwork-editor';
import { ImportPanel } from './import-panel';

type Store = { document: PlacementDocument; revision: string };
const slotLabels = { hat: '모자', top: '상의', bottom: '하의', accessory: '액세서리' };
const samePlacement = (a: LayerPlacement, b: LayerPlacement) => (Object.keys(PLACEMENT_LIMITS) as (keyof LayerPlacement)[]).every(key => a[key] === b[key]);
const rounded = (value: number) => Math.round(value * 100) / 100;
const clamp = (key: keyof LayerPlacement, value: number) => rounded(Math.min(PLACEMENT_LIMITS[key][1], Math.max(PLACEMENT_LIMITS[key][0], value)));

function NumberControl({ name, label, value, min, max, onChange }: {
  name: string; label: string; value: number; min: number; max: number; onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return <label className="number-control" htmlFor={name}><span>{label}</span>
    <input id={name} name={name} type="number" min={min} max={max} step="0.01" value={text}
      onChange={event => {
        setText(event.target.value);
        const next = event.target.valueAsNumber;
        if (Number.isFinite(next) && next >= min && next <= max) onChange(next);
      }} onBlur={() => setText(String(value))} />
    <input type="range" aria-label={`${label} 슬라이더`} min={min} max={max} step="0.1" value={value}
      onChange={event => onChange(Number(event.target.value))} />
  </label>;
}

export function WardrobeEditor({ catalog, initialStore, initialArtwork, initialItemId, imported }: { catalog: ItemCatalog; initialStore: Store; initialArtwork: ArtworkStore; initialItemId?: string; imported?: string }) {
  const [store, setStore] = useState(initialStore);
  const [artwork, setArtwork] = useState(initialArtwork);
  const [detailOpen, setDetailOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, PlacementChange>>({});
  const [itemId, setItemId] = useState(initialItemId && catalog[initialItemId] ? initialItemId : Object.keys(catalog)[0] ?? '');
  const [pose, setPose] = useState<HamsterPose>('basic');
  const [variant, setVariant] = useState<HamsterVariant>('cream');
  const [layerId, setLayerId] = useState('layers:0');
  const [lockRatio, setLockRatio] = useState(true);
  const [guides, setGuides] = useState(true);
  const [compare, setCompare] = useState(false);
  const [saving, setSaving] = useState(false);
  const [productDirty, setProductDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; placement: LayerPlacement } | null>(null);
  const changes = Object.values(drafts);
  const dirty = changes.length > 0;
  const item = catalog[itemId];
  const { frame, registration } = registeredFrame(item, pose, variant);
  const layerOptions = frame ? [
    ...frame.layers.map((layer, index) => ({ layer, index, group: 'layers' as const, label: `의상 레이어 ${index + 1}` })),
    ...(frame.foreground ?? []).map((layer, index) => ({ layer, index, group: 'foreground' as const, label: `전경 레이어 ${index + 1}` })),
  ] : [];
  const selected = layerOptions.find(option => `${option.group}:${option.index}` === layerId) ?? layerOptions[0];
  const target: PlacementTarget | undefined = selected && { itemId, pose, variant: registration, group: selected.group, index: selected.index };
  const key = target ? placementKey(target) : '';
  const previewDocument = mergePlacementChanges(catalog, store.document, changes);
  const previewCatalog = applyArtwork(applyPlacements(catalog, previewDocument), artwork.document, catalog);
  const savedCatalog = applyPlacements(catalog, store.document);
  const previewFrame = registeredFrame(previewCatalog[itemId], pose, variant).frame;
  const savedFrame = registeredFrame(savedCatalog[itemId], pose, variant).frame;
  const placement = selected ? layerPlacement(previewFrame![selected.group]![selected.index]) : undefined;
  const original = selected ? layerPlacement(selected.layer) : undefined;
  const saved = selected ? layerPlacement(savedFrame![selected.group]![selected.index]) : undefined;
  const selection = { pose, variant, ...(item?.slot === 'accessory' ? { accessories: [itemId] } : item ? { [item.slot]: itemId } : {}) };

  useEffect(() => {
    if (!dirty) return;
    function beforeUnload(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ''; }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  function updatePlacement(next: LayerPlacement) {
    if (!target || !selected || !frame || !original || !saved || saving) return;
    const change: PlacementChange = { ...target, source: placementSource(selected.layer, frame), placement: samePlacement(next, original) ? null : next };
    setDrafts(current => {
      const updated = { ...current };
      if (samePlacement(next, saved)) delete updated[key];
      else updated[key] = change;
      return updated;
    });
    setMessage('');
  }
  function resize(width: number, height: number) {
    if (!placement) return;
    const w = clamp('width', width), h = clamp('height', height);
    updatePlacement({ ...placement, width: w, height: h,
      x: clamp('x', placement.x + (placement.width - w) / 2), y: clamp('y', placement.y + (placement.height - h) / 2) });
  }
  function setDimension(dimension: 'width' | 'height', value: number) {
    if (!placement) return;
    const ratio = placement.height / placement.width;
    let width = dimension === 'width' ? value : lockRatio ? value / ratio : placement.width;
    let height = dimension === 'height' ? value : lockRatio ? value * ratio : placement.height;
    if (lockRatio) {
      const factor = Math.min(1, 4000 / width, 4000 / height);
      width *= factor; height *= factor;
      if (width < 1 || height < 1) return;
    }
    resize(width, height);
  }
  function point(event: PointerEvent<SVGRectElement>) {
    const rect = stage.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width * 1000, y: (event.clientY - rect.top) / rect.height * 1000 };
  }
  function startDrag(event: PointerEvent<SVGRectElement>) {
    if (!placement || saving || compare || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { ...point(event), pointerId: event.pointerId, placement };
  }
  function moveDrag(event: PointerEvent<SVGRectElement>) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const current = point(event), start = drag.current;
    updatePlacement({ ...start.placement, x: clamp('x', start.placement.x + current.x - start.x), y: clamp('y', start.placement.y + current.y - start.y) });
  }
  function nudge(event: KeyboardEvent<SVGRectElement>) {
    if (!placement || saving || compare) return;
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    updatePlacement({ ...placement, x: clamp('x', placement.x + direction[0] * step), y: clamp('y', placement.y + direction[1] * step) });
  }
  async function save() {
    if (!dirty || saving) return;
    setSaving(true); setMessage(''); setError(false);
    try {
      const response = await fetch('/api/wardrobe', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: store.revision, changes }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? '저장에 실패했습니다.');
      setStore(result); setDrafts({});
      setMessage(`${changes.length}개 레이어의 조정값을 로컬에 저장했습니다. 서버 등록 버튼으로 서비스에 반영하세요.`);
    } catch (cause) { setError(true); setMessage(cause instanceof Error ? cause.message : '저장에 실패했습니다. 다시 시도해 주세요.'); }
    finally { setSaving(false); }
  }
  function leave(event: React.MouseEvent<HTMLAnchorElement>) {
    if ((dirty || saving) && !window.confirm('저장하지 않은 조정값이 있습니다. 페이지를 나갈까요?')) event.preventDefault();
  }

  return <main className="wardrobe-page">
    <nav className="page-nav" aria-label="페이지"><a href="/wardrobe" onClick={leave}>아바타 관리자</a><a href="/wardrobe" aria-current="page" onClick={leave}>의상 조정</a></nav>
    <header><div className="eyebrow">PROJECT HEALTH / AVATAR MANAGER</div><h1>의상에 딱 맞는 자리.</h1><p>가져온 의상을 자세와 색상별로 맞추고, 조정한 배치를 로컬에 저장한 다음 NestJS 서버에 등록하세요.</p></header>
    <div className="editor-toolbar"><span className={`save-indicator ${dirty ? 'unsaved' : ''}`}><i />{dirty ? `저장 전 · ${changes.length}개 레이어 변경` : '모든 조정값이 저장됨'}</span>
      <div className="editor-actions"><button className="secondary-button" disabled={!dirty || saving} onClick={() => { setDrafts({}); setMessage('저장 전 변경을 모두 취소했습니다.'); setError(false); }}>변경 취소</button>
        <button className="primary-button" disabled={!dirty || saving} onClick={save}>{saving ? '저장 중…' : '조정값 저장'}</button></div>
    </div>
    {message && <p className={`editor-message ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{message}</p>}
    {imported && /^\d+$/.test(imported) && <p className="editor-message" role="status">새 의상 {imported}개를 로컬 초안에 추가했습니다. 배치를 저장하고 가격·판매 상태를 정한 뒤 서버에 등록하세요.</p>}
    <section className="workspace editor-workspace" aria-label="의상 배치 편집">
      <div className="preview-panel editor-preview"><div className="panel-top"><span>PLACEMENT PREVIEW</span><span>1000 × 1000</span></div>
        <div className={`editor-stage ${guides ? 'with-grid' : ''}`} ref={stage} data-testid="editor-preview">
          <Hamster {...selection} catalog={compare ? catalog : previewCatalog} />
          {placement && !compare && <svg className="placement-overlay" viewBox="0 0 1000 1000" aria-label="선택한 의상 이동">
            <rect data-testid="placement-boundary" x={placement.x} y={placement.y} width={placement.width} height={placement.height}
              transform={`rotate(${placement.rotation} ${placement.x + placement.width / 2} ${placement.y + placement.height / 2})`}
              fill="transparent" stroke={guides ? '#846546' : 'none'} strokeWidth="2" strokeDasharray="10 7" vectorEffect="non-scaling-stroke"
              tabIndex={saving ? -1 : 0} role="button" aria-label="의상 이동: 방향키 1, Shift와 방향키 10 단위"
              onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => { drag.current = null; }}
              onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} onKeyDown={nudge} />
            {guides && <g className="placement-center" transform={`translate(${placement.x + placement.width / 2} ${placement.y + placement.height / 2})`}><path d="M-14 0H14M0-14V14" stroke="#846546" strokeWidth="3" /></g>}
          </svg>}
          {compare && <span className="compare-badge">가져온 원래 배치</span>}
        </div>
        <div className="preview-options"><label><input type="checkbox" checked={guides} onChange={event => setGuides(event.target.checked)} />격자·경계선</label><label><input type="checkbox" checked={compare} onChange={event => setCompare(event.target.checked)} />원래 배치 비교</label></div>
        <p className="editor-hint">의상을 드래그해서 이동하세요.<br />방향키로 1, Shift + 방향키로 10 단위 이동</p>
        {selected && <div className="layer-source"><span>{selected.label} · 깊이 {selected.layer.zIndex}</span><code>{selected.layer.src}</code></div>}
      </div>
      <div className="controls editor-controls"><fieldset disabled={saving}><h2>조정할 의상</h2>
        <label htmlFor="editor-item">의상<select id="editor-item" value={itemId} onChange={event => { setItemId(event.target.value); setLayerId('layers:0'); }}>{!Object.keys(catalog).length && <option value="">가져온 의상 없음</option>}{Object.entries(catalog).map(([id, value]) => <option key={id} value={id}>{slotLabels[value.slot]} · {value.label}</option>)}</select></label>
        <div className="editor-selection-grid"><label htmlFor="editor-pose">자세<select id="editor-pose" value={pose} onChange={event => setPose(event.target.value as HamsterPose)}>{Object.entries(POSES).map(([id, value]) => <option key={id} value={id}>{value.label}{item?.poses[id as HamsterPose] ? '' : ' · 미등록'}</option>)}</select></label>
          <label htmlFor="editor-variant">색상<select id="editor-variant" value={variant} onChange={event => setVariant(event.target.value as HamsterVariant)}><option value="cream">크림</option><option value="gray">그레이</option></select></label></div>
        {!frame ? <div className="editor-empty"><strong>{item ? '이 자세·색상의 의상이 없습니다.' : '아직 가져온 의상이 없습니다.'}</strong><p>{item ? '등록된 자세와 색상을 선택하거나, 해당 PNG를 준비해 import해 주세요.' : '아래 macOS 안내에 따라 의상 세트를 먼저 import해 주세요.'}</p></div> : <>
          {registration === 'shared' && <p className="notice">같은 자세에서 두 색상이 공유하는 레이어입니다. 저장하면 크림과 그레이에 함께 적용됩니다.</p>}
          <label htmlFor="editor-layer" className="layer-picker">편집 레이어<select id="editor-layer" value={selected ? `${selected.group}:${selected.index}` : ''} onChange={event => setLayerId(event.target.value)}>{layerOptions.map(option => <option key={`${option.group}:${option.index}`} value={`${option.group}:${option.index}`}>{option.label}</option>)}</select></label>
          <button className="detail-work-button" disabled={!selected || saving} onClick={() => setDetailOpen(true)}><span>의상 세부 작업</span><small>펜 · 지우개 · 스포이드</small><span aria-hidden="true">↗</span></button>
          {placement && original && <fieldset key={key} className="transform-controls" disabled={compare}><legend>배치 조정 <small>1000 × 1000 기준</small></legend>
            <label className="ratio-lock"><input type="checkbox" checked={lockRatio} onChange={event => setLockRatio(event.target.checked)} />크기 비율 잠금</label>
            <label className="scale-control" htmlFor="editor-scale">전체 크기 <output>{rounded(placement.width / original.width * 100)}%</output><input id="editor-scale" type="range" min="1" max={Math.min(400, 4000 / original.width * 100, 4000 / placement.height * placement.width / original.width * 100)} step="0.5" value={placement.width / original.width * 100} onChange={event => { const width = original.width * Number(event.target.value) / 100; resize(width, placement.height * width / placement.width); }} /></label>
            <div className="transform-grid"><NumberControl name="editor-x" label="가로 위치 X" value={placement.x} min={-2000} max={2000} onChange={value => updatePlacement({ ...placement, x: rounded(value) })} />
              <NumberControl name="editor-y" label="세로 위치 Y" value={placement.y} min={-2000} max={2000} onChange={value => updatePlacement({ ...placement, y: rounded(value) })} />
              <NumberControl name="editor-width" label="너비" value={placement.width} min={1} max={4000} onChange={value => setDimension('width', value)} />
              <NumberControl name="editor-height" label="높이" value={placement.height} min={1} max={4000} onChange={value => setDimension('height', value)} /></div>
            <NumberControl name="editor-rotation" label="회전 (°)" value={placement.rotation} min={-180} max={180} onChange={value => updatePlacement({ ...placement, rotation: rounded(value) })} />
            <button className="secondary-button restore-button" onClick={() => updatePlacement(original)}>이 레이어를 원래 배치로</button>
            <p className="notice">크기는 중심을 유지하며 조정하고, 회전은 레이어 중심을 기준으로 적용됩니다. 비율 잠금을 해제하면 의상을 가로·세로로 따로 늘릴 수 있습니다. 복원한 배치도 저장해야 반영됩니다.</p>
          </fieldset>}
        </>}
      </fieldset></div>
    </section>
    <section className="editor-coverage" aria-label="자세별 등록 상태"><div className="section-title"><h2>자세별로 확인하기</h2><span>{variant === 'cream' ? '크림' : '그레이'} · 현재 의상</span></div><div className="pose-grid">{Object.entries(POSES).map(([id, value]) => {
      const registered = registeredFrame(item, id as HamsterPose, variant).frame;
      return <button key={id} disabled={saving} className={pose === id ? 'selected' : ''} aria-pressed={pose === id} onClick={() => setPose(id as HamsterPose)}><div><Hamster {...selection} pose={id as HamsterPose} catalog={previewCatalog} decorative /></div><span>{value.label}</span><small className="pending">{registered ? '조정 가능' : '미등록'}</small></button>;
    })}</div></section>
    <ImportPanel disabled={dirty || saving || detailOpen || productDirty} onBusyChange={setSaving} />
    {productDirty && <p className="notice">가격·판매 상태를 변경했습니다. 서버에 등록하거나 서버 연결·버전 확인으로 되돌린 후 새 상품을 가져오세요.</p>}
    <PublishPanel catalog={previewCatalog} dirty={dirty || saving || detailOpen} placementRevision={store.revision} artworkRevision={artwork.revision} onProductChange={setProductDirty} onBusyChange={setSaving} />
    <details className="import-help"><summary>macOS에서 의상 가져오기</summary><p>투명한 1000 × 1000 PNG와 manifest.json이 들어 있는 set 폴더들을 준비합니다. 개발 서버를 Control + C로 종료한 다음 프로젝트 폴더의 터미널에서 실행하세요.</p>
      <pre>{'npm run import:assets -- "/Users/사용자명/my-art/art-production/sets"\nnpm run check\nnpm run dev'}</pre><p>입력 경로는 개별 PNG나 set-001이 아닌 모든 set 폴더를 담은 <strong>sets 폴더</strong>입니다. 유지할 기존 세트도 함께 넣으세요. qa.status가 passed이고 검수자·검수 시각이 있는 프레임만 가져옵니다. 가져온 후 이 페이지를 새로고침하세요.</p></details>
    <footer>자세·색상·레이어별 저장 · PNG 원본 유지 · 저장한 배치는 착장 미리보기에도 적용</footer>
    {detailOpen && target && selected && <ArtworkEditor target={target} label={`${item.label} · ${POSES[pose].label} · ${registration === 'shared' ? '공용' : variant === 'cream' ? '크림' : '그레이'} · ${selected.label}`} onClose={() => setDetailOpen(false)} onSaved={next => { setArtwork(next); setError(false); setMessage('의상 픽셀 수정이 저장되었습니다. 배치 조정값은 유지됩니다.'); }} />}
  </main>;
}
