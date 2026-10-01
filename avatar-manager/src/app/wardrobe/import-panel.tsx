'use client';
import { useRef, useState } from 'react';

export function ImportPanel({ disabled, onBusyChange }: { disabled: boolean; onBusyChange: (busy: boolean) => void }) {
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  async function importFiles(selected: FileList | null) {
    const files = Array.from(selected ?? []).filter(file => file.name === 'manifest.json' || file.name.endsWith('.png'));
    if (!files.length) { setError(true); setMessage('manifest.json과 PNG가 들어 있는 세트 폴더를 선택하세요.'); return; }
    setBusy(true); onBusyChange(true); setError(false); setMessage('의상 이미지와 검수 정보를 확인하는 중…');
    try {
      const form = new FormData();
      form.append('paths', JSON.stringify(files.map(file => file.webkitRelativePath)));
      for (const file of files) form.append('files', file);
      const response = await fetch('/api/import', { method: 'POST', body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      window.location.assign(`/wardrobe?item=${encodeURIComponent(result.added[0])}&imported=${result.added.length}`);
    } catch (cause) { setError(true); setMessage(cause instanceof Error ? cause.message : '가져오기에 실패했습니다.'); }
    finally { setBusy(false); onBusyChange(false); if (picker.current) picker.current.value = ''; }
  }
  return <section className="import-panel" aria-label="상품 추가">
    <div className="section-title"><h2>상품 추가</h2><button className="secondary-button" disabled={disabled || busy} onClick={() => picker.current?.click()}>{busy ? '가져오는 중…' : '의상 폴더 가져오기'}</button></div>
    <p>manifest.json과 1000 × 1000 투명 PNG가 들어 있는 새 의상 세트 폴더를 선택하세요. 기존 상품과 편집 내용은 유지됩니다.</p>
    <p>가져온 상품은 로컬 초안입니다. 배치·가격·판매 상태를 확인한 뒤 아래에서 <strong>서버에 등록</strong>해야 운영 상점에 반영됩니다.</p>
    <input ref={picker} type="file" aria-label="가져올 의상 폴더" multiple {...{ webkitdirectory: '' }} hidden onChange={event => void importFiles(event.target.files)} />
    {message && <p className={`editor-message ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{message}</p>}
  </section>;
}
