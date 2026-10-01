'use client';
import { useEffect, useState } from 'react';
import { Hamster, POSES } from '@/components/hamster';
import type { HamsterPose, HamsterVariant, ItemCatalog } from '@/components/hamster';
type ProductSettings = { renderKey: string; price: number; saleStatus: 'held' | 'on_sale' | 'retired' };
type Combination = { pose: HamsterPose; variant: HamsterVariant; clothing: string[] };
export function PublishPanel({ catalog, dirty, placementRevision, artworkRevision, onProductChange, onBusyChange }: { catalog: ItemCatalog; dirty: boolean; placementRevision: string; artworkRevision: string; onProductChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void }) {
  const [revision, setRevision] = useState<number>();
  const [settings, setSettings] = useState<Record<string, ProductSettings>>({});
  const [message, setMessage] = useState('NestJS 연결을 확인하는 중…');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [combinations, setCombinations] = useState<Combination[]>([]);
  const [pose, setPose] = useState<HamsterPose>('basic');
  const [variant, setVariant] = useState<HamsterVariant>('cream');
  const [outfit, setOutfit] = useState<Record<string, string>>({});
  const [registeredKeys, setRegisteredKeys] = useState<string[]>();
  const [search, setSearch] = useState('');
  async function status(signal?: AbortSignal) {
    try {
      const response = await fetch('/api/publish', { signal, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setRevision(data.revision);
      setRegisteredKeys(Object.keys(data.catalog));
      setSettings(Object.fromEntries(Object.entries(catalog).map(([renderKey, item]) => {
        const product = data.products.find((p: ProductSettings) => p.renderKey === renderKey);
        return [renderKey, { renderKey, price: product?.price ?? ({ hat: 30, top: 25, bottom: 20, accessory: 30 }[item.slot]), saleStatus: product?.saleStatus ?? 'held' }];
      })));
      onProductChange(false);
      setError(false); setMessage(`서버 의상 버전 ${data.revision} · 연결됨${data.imageStorage === 'vercel-blob' ? ' · 이미지 저장: Vercel Blob' : data.imageStorage === 'file' ? ' · 이미지 저장: 서버 파일' : ''}`);
    } catch (cause) { if (signal?.aborted) return; setError(true); setMessage(cause instanceof Error ? cause.message : '연결 실패'); }
  }
  useEffect(() => { const controller = new AbortController(); void status(controller.signal); return () => controller.abort(); }, []);
  useEffect(() => { setReviewed(false); }, [dirty, placementRevision, artworkRevision]);
  async function submit(action: 'publish' | 'pull') {
    if (action === 'pull' && !window.confirm('서버의 등록본을 불러올까요? 현재 로컬 저장본은 .local/backups에 보관합니다.')) return;
    setBusy(true); onBusyChange(true); setError(false); setMessage(action === 'pull' ? '서버 의상을 불러오는 중…' : 'PNG와 배치를 서버에 등록하는 중…');
    try {
      const response = await fetch('/api/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, revision, products: Object.values(settings), combinations, reviewed, placementRevision, artworkRevision }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (action === 'pull') { window.location.reload(); return; }
      setRevision(result.revision); setReviewed(false);
      setRegisteredKeys(Object.keys(catalog));
      onProductChange(false);
      setMessage(`서버 버전 ${result.revision} 등록 완료. 서비스 화면을 새로고침하거나 다시 열면 수정한 의상이 표시됩니다.`);
    } catch (cause) { setError(true); setMessage(cause instanceof Error ? cause.message : '등록 실패'); }
    finally { setBusy(false); onBusyChange(false); }
  }
  function addCombination() {
    const clothing = Object.values(outfit).filter(Boolean).sort();
    if (!clothing.length || clothing.some(key => !catalog[key].poses[pose]?.[variant] && !catalog[key].poses[pose]?.shared)) { setError(true); setMessage('선택한 자세·색상에서 모든 의상 이미지가 있어야 합니다.'); return; }
    const combination = { pose, variant, clothing };
    setReviewed(false);
    setCombinations(current => current.some(c => JSON.stringify(c) === JSON.stringify(combination)) ? current : [...current, combination]);
    setError(false); setMessage('확인한 착용 조합을 등록 목록에 추가했습니다.');
  }
  return <section className="publish-panel" aria-label="서비스 의상 등록">
    <div className="section-title"><h2>서비스 의상 등록</h2><span>PROJECT HEALTH</span></div>
    <p>조정값과 픽셀을 먼저 로컬에 저장하세요. 아래 등록은 NestJS의 DB·이미지 저장소에 반영합니다.</p>
    <p>운영 등록 {registeredKeys?.length ?? '확인 중'}개 · 현재 로컬 목록 {Object.keys(catalog).length}개. 운영의 최신 목록·이미지·배치를 조회하려면 <strong>서버 등록본 불러오기</strong>를 누르세요. 로컬 초안은 백업 후 서버 등록본으로 바뀝니다.</p>
    <label className="product-search">상품 검색<input type="search" value={search} placeholder="상품명 또는 ID" onChange={event => setSearch(event.target.value)} /></label>
    <fieldset disabled={busy || dirty}>
      {Object.entries(catalog).filter(([key, item]) => `${key} ${item.label}`.toLowerCase().includes(search.toLowerCase())).map(([key, item]) => <div className="publish-product" key={key}><strong>{item.label}<small>{registeredKeys === undefined ? '등록 상태 확인 필요' : registeredKeys.includes(key) ? '운영 등록' : '로컬 초안'} · {key}</small></strong>
        <label>가격 (해바라기씨)<input type="number" aria-label={`${item.label} 등록 가격`} min={1} max={1000000} value={settings[key]?.price ?? ''} onChange={event => { onProductChange(true); setReviewed(false); setSettings(current => ({ ...current, [key]: { ...current[key], renderKey: key, price: event.target.valueAsNumber } })); }} /></label>
        <label>등록 상태<select aria-label={`${item.label} 등록 상태`} value={settings[key]?.saleStatus ?? 'held'} onChange={event => { onProductChange(true); setReviewed(false); setSettings(current => ({ ...current, [key]: { ...current[key], renderKey: key, saleStatus: event.target.value as ProductSettings['saleStatus'] } })); }}><option value="held">판매 보류</option><option value="on_sale">판매 중</option><option value="retired">판매 종료</option></select></label></div>)}
      <details><summary>여러 의상의 착용 조합 검수</summary><p>개별 의상은 검수된 프레임을 등록합니다. 모자·상의·하의를 함께 착용하려면 아래 미리보기를 확인하고 조합을 추가하세요.</p>
        <div className="publish-combination-controls"><label>자세<select value={pose} onChange={event => setPose(event.target.value as HamsterPose)}>{Object.entries(POSES).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}</select></label><label>색상<select value={variant} onChange={event => setVariant(event.target.value as HamsterVariant)}><option value="cream">크림</option><option value="gray">그레이</option></select></label>
          {(['hat', 'top', 'bottom'] as const).map(slot => <label key={slot}>{({ hat: '모자', top: '상의', bottom: '하의' })[slot]}<select value={outfit[slot] ?? ''} onChange={event => setOutfit(current => ({ ...current, [slot]: event.target.value }))}><option value="">미착용</option>{Object.entries(catalog).filter(([, item]) => item.slot === slot).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label>)}</div>
        <div className="publish-combination-preview"><Hamster pose={pose} variant={variant} hat={outfit.hat || null} top={outfit.top || null} bottom={outfit.bottom || null} catalog={catalog} /></div><button className="secondary-button" onClick={addCombination}>이 조합 검수 추가</button>
        <ul>{combinations.map((c, index) => <li key={index}>{POSES[c.pose].label} / {c.variant} / {c.clothing.map(key => catalog[key].label).join(' + ')} <button onClick={() => setCombinations(current => current.filter((_, i) => i !== index))}>제외</button></li>)}</ul>
      </details>
      <label className="publish-review"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />등록할 자세·색상과 착용 조합의 미리보기를 확인했습니다.</label>
    </fieldset>
    <p className={`editor-message ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{message}</p>
    {dirty && <p className="notice">편집 중입니다. 로컬 변경을 저장하고 세부 작업 패널을 닫으면 등록할 수 있습니다.</p>}
    <div className="publish-actions"><button className="secondary-button" disabled={busy || dirty} onClick={() => void status()}>서버 연결·버전 확인</button><button className="secondary-button" disabled={busy || dirty || revision === undefined} onClick={() => void submit('pull')}>서버 등록본 불러오기</button><button className="primary-button" disabled={busy || dirty || !reviewed || revision === undefined || !Object.keys(catalog).length} onClick={() => void submit('publish')}>{busy ? '처리 중…' : '서버에 등록'}</button></div>
  </section>;
}
