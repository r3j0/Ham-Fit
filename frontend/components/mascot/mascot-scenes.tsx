"use client";
import { useEffect, useState } from "react";
import { POSES } from "../hamster/poses";
import type { HamsterPose } from "../hamster/types";
import { MascotPose, type MascotPoseProps } from "./MascotPose";
import styles from "./mascot-scenes.module.css";

const welcome = [
  { variant: "cream", pose: "victory" },
  { variant: "gray", pose: "run" },
  { variant: "gray", pose: "drink" },
  { variant: "cream", pose: "situp" },
] as const satisfies readonly MascotPoseProps[];

export function WelcomeMascots() {
  const [characters, setCharacters] =
    useState<readonly MascotPoseProps[]>(welcome);
  useEffect(() => {
    const poses = Object.keys(POSES) as HamsterPose[];
    const values = crypto.getRandomValues(new Uint32Array(8));
    const next = Array.from({ length: 4 }, (_, i) => ({
      variant: values[i * 2] % 2 ? ("gray" as const) : ("cream" as const),
      pose: poses[values[i * 2 + 1] % poses.length],
    }));
    queueMicrotask(() => setCharacters(next));
  }, []);
  return (
    <div
      className={styles.welcome}
      role="group"
      aria-label="함께 운동하는 햄스터"
    >
      {characters.map((character, index) => (
        <MascotPose key={index} {...character} size={252} />
      ))}
    </div>
  );
}

export function SignupMascots() {
  return (
    <div
      className={styles.pair}
      role="group"
      aria-label="가입을 기다리는 햄스터"
    >
      <MascotPose pose="curious" variant="cream" size={136} />
      <MascotPose pose="curious" variant="gray" size={136} />
    </div>
  );
}
