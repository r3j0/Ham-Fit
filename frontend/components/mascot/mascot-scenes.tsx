import { MascotPose, type MascotPoseProps } from "./MascotPose";
import styles from "./mascot-scenes.module.css";

const group = [
  { variant: "cream", pose: "lying", outfit: { wear: "green-sportswear" } },
  { variant: "gray", pose: "situp", outfit: { wear: "white-sportswear" } },
  { variant: "gray", pose: "run", outfit: { wear: "blue-sportswear" } },
  { variant: "cream", pose: "cant-hear", outfit: { wear: "black-sportswear" } },
] as const satisfies readonly MascotPoseProps[];

const welcome = [
  { variant: "cream", pose: "victory", outfit: { wear: "green-sportswear" } },
  { variant: "gray", pose: "run", outfit: { wear: "white-sportswear" } },
  { variant: "gray", pose: "drink", outfit: { wear: "blue-sportswear" } },
  { variant: "cream", pose: "situp", outfit: { wear: "black-sportswear" } },
] as const satisfies readonly MascotPoseProps[];

export function GroupMascots() {
  return (
    <div
      className="home-group-mascots"
      role="group"
      aria-label="그룹 햄스터 예시"
    >
      {group.map((character) => (
        <MascotPose key={character.pose} {...character} size={96} />
      ))}
    </div>
  );
}

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
