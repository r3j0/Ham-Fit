"use client";
import Image from "next/image";
import { MemberMascot } from "./member-mascot";
import Link from "next/link";
import { assessmentHref } from "@/lib/workout-mode";
import { Notice, Shell } from "./ui";
import { OnboardingProgress } from "./onboarding-progress";
import { useUserProfile } from "./user-profile-provider";
import styles from "./onboarding.module.css";

export function Onboarding() {
  const profile = useUserProfile();
  return (
    <Shell className={`onboarding-shell ${styles.shell}`}>
      <header className={`page-header ${styles.header}`}>
        <Link
          href="/"
          className={`icon-button ${styles.back}`}
          aria-label="이전 화면"
        >
          <Image src="/onboarding/back.svg" alt="" width={20} height={20} />
        </Link>
        <h1>체력 기록 시작</h1>
      </header>
      <OnboardingProgress step={1} label="시작 방법 선택" />
      <div className="content">
        <div className={`intro ${styles.intro}`}>
          <h2 className={styles.question}>
            국민체력100
            <br />
            결과표가 있나요?
          </h2>
          <MemberMascot pose="curious" size={200} className={styles.mascot} />
        </div>
        <div className="stack">
          {profile.data?.isOnboarded && (
            <Notice tone="info">
              이미 등록한 기록이 있어요. 새로운 측정 결과를 추가할 수 있어요.
              <Link href="/measurements" className="text-link">
                내 측정 기록 보기
              </Link>
            </Notice>
          )}
          <Link
            href="/onboarding/photo"
            className={`${styles.choice} ${styles.primaryChoice}`}
            aria-labelledby="photo-choice-title"
          >
            <span className={styles.iconBox}>
              <Image
                src="/onboarding/camera.png"
                alt=""
                width={28}
                height={28}
              />
            </span>
            <h3 id="photo-choice-title" className={styles.choiceTitle}>
              결과표가 있어요
            </h3>
            <Image
              className={styles.chevron}
              src="/onboarding/chevron.svg"
              alt=""
              width={18}
              height={18}
            />
          </Link>
          <Link
            href={assessmentHref}
            className={styles.choice}
            aria-labelledby="assessment-choice-title"
          >
            <span className={styles.iconBox}>
              <Image
                src="/onboarding/activity.svg"
                alt=""
                width={28}
                height={28}
              />
            </span>
            <h3 id="assessment-choice-title" className={styles.choiceTitle}>
              결과표가 없어요
            </h3>
            <Image
              className={styles.chevron}
              src="/onboarding/chevron.svg"
              alt=""
              width={18}
              height={18}
            />
          </Link>
          <Link href="/onboarding/manual" className={styles.manual}>
            <Image src="/onboarding/pencil.svg" alt="" width={16} height={16} />
            직접 입력하기
          </Link>
        </div>
      </div>
    </Shell>
  );
}
