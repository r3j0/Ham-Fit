"use client";
import { useAvatarCatalog } from "./avatar-catalog-provider";
import { SeedIcon } from "./seed-icon";
import styles from "./avatar-shop.module.css";
import Link from "next/link";
import { useRef, useState } from "react";
import type { AvatarOutfit } from "@/lib/avatar-outfit";
import { isExcludedSportswear } from "@/lib/avatar-rendering";
import {
  getCatalog,
  getInventory,
  getOutfit,
  purchase,
  saveOutfit,
  shopError,
} from "@/lib/shop";
import {
  sameSelection,
  supportedSelection,
  type OutfitSelection,
  type Product,
} from "@/lib/shop-contract";
import {
  previewOutfit,
  productName,
  selectProduct,
} from "@/lib/avatar-preview";
import { useApiResource } from "./use-api-resource";
import { useDurableMutation } from "./use-durable-mutation";
import { useOperationScope } from "./use-operation-scope";
import { useUnsaved } from "./use-unsaved";
import { ProfileCharacter } from "./profile-character";
import { HamsterFace } from "./hamster-face";
import { SeedBalance } from "./seed-balance";
import { Dialog, Header, Loading, Notice, Shell, SubmitLabel } from "./ui";

const loadShop = async (signal: AbortSignal) => {
  const [catalog, inventory, outfit] = await Promise.all([
    getCatalog(signal),
    getInventory(signal),
    getOutfit(signal),
  ]);
  return { catalog, inventory, outfit };
};
type ShopData = Awaited<ReturnType<typeof loadShop>>;
const categories = [
  { id: "hat", label: "모자" },
  { id: "top", label: "상의" },
  { id: "bottom", label: "하의" },
  { id: "pose", label: "자세" },
] as const;
export function AvatarShop({ wardrobe = false }: { wardrobe?: boolean }) {
  const resource = useApiResource(loadShop);
  return (
    <Shell>
      <Header
        title={wardrobe ? "내 옷장" : "상점"}
        back={wardrobe ? "/shop" : undefined}
        showBrand={false}
      />
      <div className="content stack">
        {resource.error ? (
          <>
            <Notice>{shopError(resource.error)}</Notice>
            <button className="button secondary" onClick={resource.reload}>
              다시 불러오기
            </button>
          </>
        ) : null}
        {resource.data ? (
          <ShopView
            data={resource.data}
            wardrobe={wardrobe}
            reload={resource.reload}
          />
        ) : (
          !resource.error && <Loading />
        )}
      </div>
    </Shell>
  );
}
function ShopView({
  data,
  wardrobe,
  reload,
}: {
  data: ShopData;
  wardrobe: boolean;
  reload: () => void;
}) {
  const { catalog, inventory } = data;
  const [acknowledged, setAcknowledged] = useState<AvatarOutfit>();
  const outfit =
    acknowledged && acknowledged.revision > data.outfit.revision
      ? acknowledged
      : data.outfit;
  const [draft, setDraft] = useState<OutfitSelection>(outfit);
  const [revision, setRevision] = useState(outfit.revision);
  const [category, setCategory] = useState<string>("hat");
  const [selected, setSelected] = useState<Product>();
  const [confirm, setConfirm] = useState(false),
    [saving, setSaving] = useState(false);
  const [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const purchaseMutation = useDurableMutation("shop:purchase");
  const guard = useRef(false),
    begin = useOperationScope();
  const owned = new Set(inventory.inventory.map((i) => i.productId));
  const assetResource = useAvatarCatalog();
  const assets = assetResource.catalog ?? {};
  const preview = previewOutfit(catalog, draft, outfit, assets);
  const valid = supportedSelection(catalog, draft) && !!preview;
  const ownSelection = [
    draft.characterId,
    draft.poseId,
    ...draft.clothingIds,
  ].every((id) => owned.has(id));
  const dirty = !sameSelection(draft, outfit);
  const busy = saving || purchaseMutation.busy;
  useUnsaved((wardrobe && dirty) || busy);
  const products = catalog.products.filter(
    (p) =>
      !isExcludedSportswear(p.renderKey) &&
      (category === "pose" ? p.kind === "pose" : p.slot === category) &&
      (wardrobe ? owned.has(p.id) : p.saleStatus !== "retired"),
  );
  async function buy() {
    const product = selected;
    if (
      !purchaseMutation.pending &&
      (!product || product.priceProvisional || product.saleStatus !== "on_sale")
    )
      return;
    const current = begin();
    setError("");
    setMessage("");
    try {
      const result = await purchaseMutation.run(
        JSON.stringify({
          productId: product?.id,
          catalogRevision: product?.catalogRevision,
        }),
        purchase,
      );
      if (!current() || !result) return;
      setConfirm(false);
      setMessage("구매했어요. 내 옷장에서 착용하고 저장할 수 있어요.");
      reload();
    } catch (e) {
      if (current()) {
        setError(shopError(e));
        setSelected(undefined);
        setConfirm(false);
        reload();
      }
    }
  }
  async function save() {
    if (guard.current || busy || !valid || !ownSelection || !dirty) return;
    guard.current = true;
    setSaving(true);
    setError("");
    setMessage("");
    const current = begin();
    try {
      const saved = await saveOutfit(draft, revision);
      if (!current()) return;
      setAcknowledged(saved);
      setRevision(saved.revision);
      setDraft(saved);
      setMessage("대표 코디를 저장했어요.");
      reload();
    } catch (e) {
      if (current()) {
        setError(shopError(e));
        reload();
      }
    } finally {
      if (current()) {
        guard.current = false;
        setSaving(false);
      }
    }
  }
  return (
    <>
      <div className={styles.layout}>
        <div className={styles.preview}>
          <section
            className={
              wardrobe ? "shop-stage" : `shop-stage ${styles.shopPreview}`
            }
            aria-label="코디 미리보기"
          >
            {!wardrobe && (
              <Link
                href="/shop/wardrobe"
                className={`button ${styles.wardrobeLink}`}
              >
                내 옷장
              </Link>
            )}
            {preview ? (
              <ProfileCharacter
                outfit={preview}
                size={wardrobe ? 280 : 196}
                label="내 캐릭터 미리보기"
              />
            ) : (
              <p>이 코디의 이미지는 준비 중이에요.</p>
            )}
            {wardrobe && (
              <div
                className="shop-character-choices"
                role="group"
                aria-label="캐릭터 선택"
              >
                {catalog.products
                  .filter(
                    (p) =>
                      p.kind === "character" &&
                      owned.has(p.id) &&
                      ["cream", "gray"].includes(p.renderKey),
                  )
                  .map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      aria-label={productName(p, assets)}
                      title={productName(p, assets)}
                      aria-pressed={draft.characterId === p.id}
                      disabled={busy}
                      onClick={() => {
                        setDraft(selectProduct(draft, p, catalog));
                        setMessage("");
                      }}
                    >
                      <HamsterFace variant={p.renderKey as "cream" | "gray"} />
                    </button>
                  ))}
              </div>
            )}
            {!!draft.clothingIds.length && (
              <button
                className={`text-button ${styles.reset}`}
                disabled={busy}
                onClick={() => setDraft({ ...draft, clothingIds: [] })}
              >
                초기화
              </button>
            )}
            <SeedBalance balance={inventory.currency.balance} />
          </section>
          {!wardrobe && selected && !owned.has(selected.id) && (
            <button
              className="button primary"
              disabled={
                busy ||
                !!purchaseMutation.pending ||
                selected.saleStatus !== "on_sale" ||
                selected.priceProvisional ||
                !preview ||
                (selected.price ?? Infinity) > inventory.currency.balance
              }
              onClick={() => setConfirm(true)}
            >
              {selected.priceProvisional
                ? "가격 확정 후 구매할 수 있어요"
                : (selected.price ?? Infinity) > inventory.currency.balance
                  ? "해바라기씨가 부족해요"
                  : `${productName(selected, assets)} 구매하기 · ${selected.price}개`}
            </button>
          )}
          {error && <Notice>{error}</Notice>}
          {message && <Notice tone="success">{message}</Notice>}
          {purchaseMutation.pending && (
            <Notice tone="info">
              확인이 끝나지 않은 구매가 있어요. 같은 요청으로 결과를 확인해
              주세요.
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void buy()}
              >
                이전 구매 결과 확인
              </button>
            </Notice>
          )}
          {wardrobe && (
            <div className="stack-sm">
              {outfit.revision !== revision && (
                <Notice>
                  저장된 코디가 변경되었어요. 최신 코디를 불러와 주세요.
                </Notice>
              )}
              {!valid && (
                <Notice tone="info">
                  함께 착용할 수 없는 조합이에요. 자세나 의상을 바꿔 주세요.
                </Notice>
              )}
              <div className="button-row">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => {
                    setDraft(outfit);
                    setRevision(outfit.revision);
                    setError("");
                    setMessage("");
                  }}
                >
                  되돌리기
                </button>
                <button
                  className="button primary"
                  disabled={
                    busy ||
                    !dirty ||
                    !valid ||
                    !ownSelection ||
                    outfit.revision !== revision
                  }
                  onClick={() => void save()}
                >
                  <SubmitLabel busy={saving}>코디 저장</SubmitLabel>
                </button>
              </div>
            </div>
          )}
        </div>
        <div className={styles.items}>
          <div
            className="shop-categories"
            role="group"
            aria-label="아이템 종류"
          >
            {categories.map((c) => (
              <button
                key={c.id}
                aria-pressed={category === c.id}
                onClick={() => {
                  setCategory(c.id);
                  setSelected(undefined);
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
          {!products.length && (
            <div className="empty-state">
              <h2>
                {wardrobe
                  ? "아직 보유한 아이템이 없어요"
                  : "상품을 준비하고 있어요"}
              </h2>
              <p>
                {wardrobe
                  ? "상점에서 마음에 드는 아이템을 만나 보세요."
                  : "등록되면 여기에서 확인할 수 있어요."}
              </p>
            </div>
          )}
          <div className="shop-grid">
            {products.map((p) => {
              const candidate = selectProduct(draft, p, catalog);
              const active =
                p.kind === "pose"
                  ? draft.poseId === p.id
                  : draft.clothingIds.includes(p.id);
              const art = previewOutfit(
                catalog,
                active ? draft : candidate,
                outfit,
                assets,
              );
              return (
                <button
                  className="shop-item"
                  key={p.id}
                  aria-pressed={active}
                  disabled={busy || !!purchaseMutation.pending}
                  onClick={() => {
                    setSelected(p);
                    setDraft(candidate);
                    setMessage("");
                    setError("");
                  }}
                >
                  <span className="shop-item-art">
                    {art ? (
                      <ProfileCharacter outfit={art} size={94} label="" />
                    ) : (
                      <span>이미지 준비 중</span>
                    )}
                  </span>
                  <strong>{productName(p, assets)}</strong>
                  <span>
                    {owned.has(p.id) ? (
                      "보유 중"
                    ) : p.saleStatus !== "on_sale" ? (
                      "판매 준비 중"
                    ) : (
                      <>
                        <SeedIcon height={18} /> {p.price}개
                        {p.priceProvisional ? " · 가격 확정 전" : ""}
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {confirm && selected && (
        <Dialog
          title="이 아이템을 구매할까요?"
          onClose={() => setConfirm(false)}
          busy={busy}
        >
          <p>
            {productName(selected, assets)} · 해바라기씨 {selected.price}개
          </p>
          <p>구매 후 옷장에서 착용할 수 있어요.</p>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void buy()}
          >
            <SubmitLabel busy={busy}>구매 확정</SubmitLabel>
          </button>
        </Dialog>
      )}
    </>
  );
}
