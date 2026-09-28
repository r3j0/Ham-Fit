export function StepAssessmentHelp({
  sex,
  height,
  weight,
}: {
  sex: string;
  height: string;
  weight: string;
}) {
  const missing = [
    !sex && "성별",
    !height.trim() && "신장",
    !weight.trim() && "체중",
  ].filter(Boolean);
  return (
    <div className="stack-sm caption">
      <p>
        스텝검사는 측정 당시 성별·만 나이·신장·체중으로 최대산소섭취량을 추정해
        심폐지구력 참고 등급을 계산해요.
      </p>
      {!!missing.length && (
        <p>
          스텝검사 평가에 필요한 정보: {missing.join(" · ")}. 비워 두어도
          측정값은 저장할 수 있어요.
        </p>
      )}
    </div>
  );
}
