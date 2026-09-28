# 햄스터 출력 도구

`프라이빗 디자인 대기 모션 제작`의 `/private/tmp/project-health-idle-motion/component`와 검증된 React 어댑터를 이식했습니다. 추가 런타임 의존성이나 외형 저장 API를 만들지 않습니다.

## 기본 호흡

`BreathingMascot`은 로그인 후 메인의 5.6초 기본 호흡과 프로필 얼굴을 표시합니다. 최신 원본 `breathing-rig.js`를 사용하며 기존 `framing="face"`와 전신 표시를 유지합니다. 숨겨진 탭·동작 줄이기·언마운트 정리를 지원합니다. `variant`, `motion`, `cycleSeconds`, `intensity`, `paused`, `label`, `size`로 제어합니다.

## 자세와 의상

```tsx
import { MascotPose } from "@/components/mascot/MascotPose";

<MascotPose pose="run" variant="gray" outfit={{ wear: "white-sportswear" }} size={160} />
<MascotPose pose="curious" variant="cream" size={144} />
```

- 13자세: `basic`, `curious`, `a-plus`, `drink`, `lying`, `stretch`, `run`, `passion`, `victory`, `pushup`, `situp`, `droopy`, `cant-hear`.
- 의상: `blue-sportswear`, `black-sportswear`, `white-sportswear`, `green-sportswear`. `{}`는 미착용입니다.
- `label=""`은 접근성 트리에서 숨기는 장식용 출력입니다.
- 원본 PNG와 캐릭터별 viewBox/clipPath/특수 다각형을 유지합니다. 전체 의상·자세를 사용할 수 있도록 `public/mascots/poses`에 원본을 함께 보관합니다.
- React 어댑터는 `useId`로 인스턴스마다 clip ID를 구분합니다. 선택한 시트만 Next 이미지 최적화를 거쳐 표시 크기에 맞게 요청하며 전체 카탈로그를 선로딩하지 않습니다. 서버 렌더링과 첫 클라이언트 렌더링이 같은 구조를 사용합니다.
- 의상·13자세는 정지 이미지입니다. 기본 호흡/걷기와 구분하며, 임의로 의상 이미지를 변형하지 않습니다.
- 의상 선택은 컴포넌트 props입니다. 프로필 저장·구매·보상·그룹 멤버 API나 공용 localStorage를 연결하지 않습니다.

메타데이터와 원본 출처·해시는 원본 키트의 기록을 보존합니다. 코드만 프로젝트의 Prettier 형식으로 정리했습니다.
