import { MascotPose, type MascotPoseProps } from "./MascotPose";
import styles from "./mascot-scenes.module.css";

const welcome = [
  { variant: "cream", pose: "victory" },
  { variant: "gray", pose: "run" },
  { variant: "gray", pose: "drink" },
  { variant: "cream", pose: "situp" },
] as const satisfies readonly MascotPoseProps[];

export function WelcomeMascots() {
  return (
    <div
      className={styles.welcome}
      role="group"
      aria-label="함께 운동하는 햄스터"
    >
      {welcome.map((character) => (
        <MascotPose key={character.pose} {...character} size={180} />
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
