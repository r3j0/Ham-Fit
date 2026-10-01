"use client";
import { useEffect, useState } from "react";
import { POSES } from "../hamster/poses";
import type { HamsterPose } from "../hamster/types";
import { MascotPose, type MascotPoseProps } from "./MascotPose";
import styles from "./mascot-scenes.module.css";
import { selectWelcomeMascots } from "@/lib/welcome-mascots";

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
    const next = selectWelcomeMascots(
      poses,
      () => crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000,
    );
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
      <MascotPose pose="curious" variant="cream" size={190.4} />
      <MascotPose pose="curious" variant="gray" size={190.4} />
    </div>
  );
}
