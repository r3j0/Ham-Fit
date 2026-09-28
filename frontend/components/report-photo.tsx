"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { Header, Notice, Shell } from "./ui";
import { RecordForm } from "./record-form";
import photoStyles from "./photo-input-workspace.module.css";
import styles from "./report-photo.module.css";
import { OnboardingProgress } from "./onboarding-progress";
import { useOperationScope } from "./use-operation-scope";
import { api, getSession } from "@/lib/session";
import { ApiError, errorMessage } from "@/lib/http";
import { measurementDrafts } from "@/lib/measurement-drafts";
import {
  canReviewExtraction,
  extractionSeed,
  extractionStatusText,
  parseExtraction,
  type ExtractionDraft,
} from "@/lib/extraction";

type Photo = { file: File; url: string; width: number; height: number };
const extractionErrors: Record<string, string> = {
  EXTRACTION_UNAVAILABLE:
    "사진 분석을 아직 사용할 수 없어요. 결과표를 보며 직접 입력할 수 있어요.",
  EXTRACTION_TIMEOUT:
    "사진 분석 시간이 초과됐어요. 다시 시도하거나 직접 입력해 주세요.",
  IMAGE_TOO_LARGE: "10MB 이하의 사진을 선택해 주세요.",
  IMAGE_DIMENSIONS_EXCEEDED:
    "사진 해상도가 너무 높아요. 크기를 줄인 사진을 선택해 주세요.",
  INVALID_IMAGE: "손상된 사진이에요. 다른 사진을 선택해 주세요.",
  UNSUPPORTED_IMAGE: "JPG, PNG, WEBP 사진을 선택해 주세요.",
  MULTI_FRAME_IMAGE:
    "여러 프레임이 있는 이미지예요. 정지 사진 한 장을 선택해 주세요.",
  IMAGE_TYPE_MISMATCH:
    "파일 형식과 실제 사진이 달라요. 다른 사진을 선택해 주세요.",
  OPENAI_REFUSAL:
    "이 사진을 분석할 수 없어요. 다른 사진을 선택하거나 직접 입력해 주세요.",
};
export function ReportPhoto() {
  const [resume] = useState(
    () => !!measurementDrafts.read(getSession().user!.id, "photo"),
  );
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [draft, setDraft] = useState<ExtractionDraft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"image" | "extract" | null>(null);
  const [entering, setEntering] = useState(resume);
  const [cooldown, setCooldown] = useState(0);
  const controller = useRef<AbortController | null>(null),
    guard = useRef(false);
  const beginOperation = useOperationScope();
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo.url);
    },
    [photo],
  );
  useEffect(() => {
    if (!cooldown) return;
    const timer = setInterval(() => {
      if (Date.now() >= cooldown) setCooldown(0);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);
  async function select(file: File | undefined) {
    if (!file) return;
    controller.current?.abort();
    guard.current = false;
    const isCurrent = beginOperation();
    setError("");
    setDraft(null);
    setPhoto(null);
    setBusy(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("JPG, PNG, WEBP 사진을 선택해 주세요.");
      return;
    }
    if (!file.size || file.size > 10 * 1024 * 1024) {
      setError("0바이트보다 크고 10MB 이하인 사진을 선택해 주세요.");
      return;
    }
    setBusy("image");
    const url = URL.createObjectURL(file);
    try {
      const decoded = new window.Image();
      decoded.src = url;
      await decoded.decode();
      if (!isCurrent()) {
        URL.revokeObjectURL(url);
        return;
      }
      setPhoto({
        file,
        url,
        width: decoded.naturalWidth,
        height: decoded.naturalHeight,
      });
    } catch {
      URL.revokeObjectURL(url);
      if (isCurrent())
        setError("사진을 읽을 수 없어요. 다른 사진을 선택해 주세요.");
    } finally {
      if (isCurrent()) setBusy(null);
    }
  }
  async function extract() {
    if (!photo || guard.current || busy || cooldown) return;
    guard.current = true;
    const isCurrent = beginOperation(),
      abort = new AbortController();
    controller.current = abort;
    setBusy("extract");
    setError("");
    setDraft(null);
    const form = new FormData();
    form.append("image", photo.file);
    try {
      const response = await api<unknown>("/measurements/extract", {
        method: "POST",
        body: form,
        signal: abort.signal,
        // Backend processing may take 75s; allow time for upload and transit.
        timeoutMs: 90000,
      });
      if (isCurrent()) setDraft(parseExtraction(response.data));
    } catch (cause) {
      if (!isCurrent() || abort.signal.aborted) return;
      setError(
        cause instanceof ApiError
          ? (extractionErrors[cause.code ?? ""] ??
              (cause.status === 404
                ? extractionErrors.EXTRACTION_UNAVAILABLE
                : errorMessage(cause)))
          : errorMessage(cause),
      );
      if (cause instanceof ApiError && cause.status === 429 && cause.retryAfter)
        setCooldown(Date.now() + cause.retryAfter * 1000);
    } finally {
      if (isCurrent()) {
        setBusy(null);
        guard.current = false;
      }
    }
  }
  function cancel() {
    controller.current?.abort();
    beginOperation();
    guard.current = false;
    setBusy(null);
    setError("사진 분석을 취소했어요.");
  }
  if (entering)
    return (
      <RecordForm
        onboarding
        requireSex
        draftKey="photo"
        onDiscard={() => {
          setDraft(null);
          setPhoto(null);
          setError("");
          setEntering(false);
        }}
        seed={
          draft && canReviewExtraction(draft)
            ? extractionSeed(draft)
            : undefined
        }
        reference={
          photo ? (
            <Image
              className={photoStyles.reportImage}
              src={photo.url}
              alt="선택한 국민체력100 결과표"
              width={photo.width}
              height={photo.height}
              unoptimized
            />
          ) : (
            <div className={photoStyles.placeholder}>
              <p>
                입력한 값은 유지되어 있어요. 사진을 다시 연결하면 결과표를 보며
                이어서 입력할 수 있어요.
              </p>
              <label className="button secondary file-button">
                <ImagePlus size={18} /> 사진 다시 연결
                <input
                  aria-label="결과표 사진 다시 연결"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={!!busy}
                  onChange={(event) => {
                    void select(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
              {error && <Notice>{error}</Notice>}
            </div>
          )
        }
      />
    );
  return (
    <Shell className="onboarding-shell">
      <Header title="결과표 사진 선택" back="/onboarding" />
      <OnboardingProgress
        step={2}
        label={
          busy === "extract"
            ? "결과표 분석 중"
            : draft
              ? "분석 결과 확인"
              : "결과표 사진 등록"
        }
      />
      <div className="content stack">
        <div className="intro">
          <h2>결과표가 잘 보이게 선택해 주세요</h2>
          <p>측정값과 단위가 선명하게 보이는 사진이 좋아요.</p>
        </div>
        {photo ? (
          <div className={styles.selection}>
            <figure className={styles.preview}>
              <Image
                className={styles.previewImage}
                src={photo.url}
                alt="선택한 국민체력100 결과표"
                width={photo.width}
                height={photo.height}
                unoptimized
              />
            </figure>
            <div className={styles.actions}>
              <button
                className={`button ${draft && canReviewExtraction(draft) ? "secondary" : "primary"}`}
                disabled={!!busy || !!cooldown}
                onClick={() => void extract()}
              >
                {draft ? "사진 다시 분석" : "측정값 읽기"}
              </button>
              {busy === "extract" && (
                <button className="button secondary" onClick={cancel}>
                  분석 취소
                </button>
              )}
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={() => {
                  setDraft(null);
                  setEntering(true);
                }}
              >
                이 사진을 보며 직접 입력
              </button>
              <button
                className="text-button"
                disabled={!!busy}
                onClick={() => {
                  setPhoto(null);
                  setDraft(null);
                  setError("");
                }}
              >
                사진 지우기
              </button>
            </div>
          </div>
        ) : (
          <label className="button secondary file-button">
            <ImagePlus size={18} /> 사진 선택
            <input
              aria-label="결과표 파일 선택"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={!!busy}
              onChange={(event) => {
                void select(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
        )}
        <p className="caption">
          JPG, PNG, WEBP · 최대 10MB. 사진 분석을 요청하면 OpenAI에 사진이
          전송됩니다.
        </p>
        {busy && (
          <Notice tone="info">
            {busy === "extract"
              ? "측정값을 분석하고 있어요. 잠시만 기다려 주세요."
              : "사진을 확인하고 있어요."}
          </Notice>
        )}
        {error && <Notice>{error}</Notice>}
        {!!cooldown && (
          <p role="status" className="caption">
            요청 제한 시간이 지나면 사진 분석을 다시 시도할 수 있어요.
          </p>
        )}
        {photo && draft && (
          <section className={styles.extraction} aria-label="사진 추출 결과">
            <Notice tone="info">일부 내용을 확인해야 해요.</Notice>
            {(!canReviewExtraction(draft) ||
              draft.status === "grades_only") && (
              <Notice tone="info">{extractionStatusText[draft.status]}</Notice>
            )}
            {draft.items.length > 0 ? (
              <div>
                <h3>읽은 측정값</h3>
                <ul className={styles.resultList} aria-label="읽은 측정값">
                  {draft.items.map((item) => (
                    <li className={styles.readItem} key={item.measurementCode}>
                      <span>{item.evidence.label || item.measurementCode}</span>
                      <strong>
                        {item.value} {item.unit}
                      </strong>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="caption">사진에서 읽은 측정값이 없어요.</p>
            )}
            {draft.reviewItems.length > 0 && (
              <div>
                <h3>확인할 항목</h3>
                <ul className={styles.resultList} aria-label="확인할 항목">
                  {draft.reviewItems.map((item, index) => (
                    <li className={styles.reviewItem} key={index}>
                      <span>
                        {item.evidence.label ||
                          item.measurementCode ||
                          "확인할 항목"}
                      </span>
                      <strong>
                        {item.value ?? item.evidence.value ?? "판독 불가"}{" "}
                        {item.unit ?? item.evidence.unit ?? ""}
                      </strong>
                      {item.reportedGrade && (
                        <small>결과표 등급: {item.reportedGrade}</small>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {canReviewExtraction(draft) && (
              <button
                className="button primary"
                onClick={() => setEntering(true)}
              >
                결과표 확정
              </button>
            )}
          </section>
        )}
        <Link className="text-link" href="/onboarding/manual">
          사진 없이 직접 입력하기
        </Link>
      </div>
    </Shell>
  );
}
