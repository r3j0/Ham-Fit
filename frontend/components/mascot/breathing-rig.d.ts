export type MascotMotion = "idle" | "walk";
export const MOTION_PRESETS: {
  id: MascotMotion;
  label: string;
  cycleSeconds: number;
  min: number;
  max: number;
  description: string;
}[];
export type RigOptions = {
  motion?: MascotMotion;
  cycleSeconds?: number;
  intensity?: number;
  paused?: boolean;
};
export type RigController = {
  update(options: RigOptions): void;
  getState(): {
    motion: MascotMotion;
    phase: number;
    running: boolean;
    reducedMotion: boolean;
    cycleSeconds: number;
    intensity: number;
    paused: boolean;
  };
  seek(phase: number): void;
  destroy(): void;
};
export type FootPose = {
  x: number;
  y: number;
  angle: number;
  planted: boolean;
  scaleX?: number;
  scaleY?: number;
};
export type WalkPose = {
  x: number;
  y: number;
  angle: number;
  arm: number;
  nod: number;
  headY: number;
  leftFoot: FootPose;
  rightFoot: FootPose;
};
export function createBreathingRig(
  svg: SVGSVGElement,
  options?: RigOptions,
): RigController;
export function createMascotRig(
  svg: SVGSVGElement,
  options?: RigOptions,
): RigController;
export function getBreathPose(
  phase: number,
  intensity?: number,
): { chest: number; head: number; arms: number; belly: number };
export function getWalkPose(phase: number, intensity?: number): WalkPose;
export function compileTorsoMorph(path: string): (breath: number) => string;
export function compileWalkMorph(path: string): (pose: WalkPose) => string;
