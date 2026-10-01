import type { CSSProperties } from 'react';
import type { POSES } from './poses';
import type { DEFAULT_ITEMS } from './items';

export type HamsterVariant = 'cream' | 'gray';
export type HamsterPose = keyof typeof POSES;
export type HamsterSlot = 'hat' | 'top' | 'bottom' | 'accessory';
/** All coordinates use the same 1000 × 1000 square. Degrees rotate about the rectangle center. */
export interface LayerAsset {
  src: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  /** Stretch only explicitly adjusted wardrobe rectangles; the stage and base retain their proportions. */
  fit?: 'contain' | 'stretch';
  zIndex: number;
}
export interface PoseLayers {
  /** Only explicitly registered poses are supported; never borrow another pose's artwork. */
  layers: readonly LayerAsset[];
  /** Item-owned foreground, active only when this item is selected. Set zIndex per anatomical depth. */
  foreground?: readonly LayerAsset[];
  qa?: { status: string; reviewer: string; reviewedAt: string; [key: string]: unknown };
}
export interface HamsterItem {
  slot: HamsterSlot;
  label: string;
  setId?: string;
  poses: Partial<Record<HamsterPose, Partial<Record<HamsterVariant | 'shared', PoseLayers>>>>;
}
export type ItemCatalog = Readonly<Record<string, HamsterItem>>;
export type ItemId<C extends ItemCatalog, S extends HamsterSlot> = {
  [K in keyof C]: S extends C[K]['slot'] ? K : never;
}[keyof C] & string;
export interface HamsterProps<C extends ItemCatalog = typeof DEFAULT_ITEMS> {
  variant?: HamsterVariant;
  pose?: HamsterPose;
  hat?: ItemId<NoInfer<C>, 'hat'> | null;
  top?: ItemId<NoInfer<C>, 'top'> | null;
  bottom?: ItemId<NoInfer<C>, 'bottom'> | null;
  accessories?: readonly ItemId<NoInfer<C>, 'accessory'>[];
  catalog?: C;
  /** Prefix public URLs, e.g. /my-app for Next basePath. No automatic network fetches. */
  assetPrefix?: string;
  className?: string;
  style?: CSSProperties;
  label?: string;
  decorative?: boolean;
}
export interface RenderSelection {
  variant?: string;
  pose?: string;
  hat?: string | null;
  top?: string | null;
  bottom?: string | null;
  accessories?: readonly string[];
}
export interface ResolvedLayer extends LayerAsset { key: string }
