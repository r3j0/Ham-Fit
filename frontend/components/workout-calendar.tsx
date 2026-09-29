"use client";
import Link from "next/link";
import { useWorkoutHistoryLinks } from "./use-workout-history-links";
import { useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import {
  calendarWeek,
  calendarWeeks,
  completedDate,
  dateFromKey,
  shiftDay,
  shiftMonth,
} from "@/lib/workout-history";
import {
  useWorkoutHistory,
  WorkoutHistoryFeedback,
} from "./workout-history-provider";
import styles from "./workout-history.module.css";

export function WorkoutCalendar({ selectedDate }: { selectedDate?: string }) {
  const { today, ready, error, loading } = useWorkoutHistory();
  return (
    <section
      className={styles.calendar}
      aria-labelledby="workout-history-title"
      aria-busy={loading}
    >
      {!ready || error ? (
        <>
          <div className={styles.heading}>
            <h2 id="workout-history-title">운동 기록</h2>
          </div>
          <WorkoutHistoryFeedback />
        </>
      ) : (
        <CalendarBody
          key={`${today}:${selectedDate ?? ""}`}
          selectedDate={selectedDate}
        />
      )}
    </section>
  );
}

function CalendarBody({ selectedDate }: { selectedDate?: string }) {
  const { basePath } = useWorkoutHistoryLinks();

  const { today, completed, workouts } = useWorkoutHistory();
  const currentMonth = today.slice(0, 7);
  const [view, setView] = useState<"week" | "month">(
    selectedDate ? "week" : "month",
  );
  const [focusDate, setFocusDate] = useState(selectedDate ?? today);
  const month = focusDate.slice(0, 7);
  const [year, monthNumber] = month.split("-").map(Number);
  const monthLabel = `${year}년 ${monthNumber}월`;
  const week = calendarWeek(focusDate);
  const rows = view === "week" ? [week] : calendarWeeks(month);
  const visibleDays = rows.flat().filter((day): day is string => day !== null);
  const count = visibleDays.filter((day) => completed.has(day)).length;
  const periodLabel =
    view === "month" ? monthLabel : formatWeekLabel(week[0], week[6]);
  const nextDisabled =
    view === "month" ? month >= currentMonth : week[6] >= today;
  const durationByDate = new Map<string, number>();
  for (const workout of workouts) {
    const day = completedDate(workout);
    if (!day) continue;
    durationByDate.set(
      day,
      (durationByDate.get(day) ?? 0) + workout.video.durationSeconds,
    );
  }

  function changePeriod(direction: number) {
    if (view === "week") {
      setFocusDate((day) => shiftDay(day, direction * 7));
      return;
    }
    const nextMonth = shiftMonth(month, direction);
    setFocusDate(nextMonth === currentMonth ? today : `${nextMonth}-01`);
  }

  return (
    <>
      <div className={styles.heading}>
        <h2 id="workout-history-title">운동 기록</h2>
        {selectedDate && (
          <div className={styles.viewSwitch} aria-label="달력 보기">
            <button
              type="button"
              aria-pressed={view === "week"}
              onClick={() => setView("week")}
            >
              주
            </button>
            <button
              type="button"
              aria-pressed={view === "month"}
              onClick={() => setView("month")}
            >
              월
            </button>
          </div>
        )}
      </div>
      <div className={styles.monthNavigation}>
        <button
          type="button"
          className="icon-button"
          aria-label={`이전 ${view === "week" ? "주" : "달"}`}
          onClick={() => changePeriod(-1)}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <h3 aria-live="polite">{periodLabel}</h3>
        <button
          type="button"
          className="icon-button"
          aria-label={`다음 ${view === "week" ? "주" : "달"}`}
          disabled={nextDisabled}
          onClick={() => changePeriod(1)}
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>
      <div
        className={styles.monthSummary}
        data-detail={selectedDate || undefined}
      >
        {!selectedDate && (
          <p>
            <strong>{count}일</strong> 운동했어요
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setFocusDate(today);
          }}
        >
          오늘
        </button>
      </div>
      <table className={styles.monthGrid}>
        <caption className="sr-only">{periodLabel} 운동 기록</caption>
        <thead>
          <tr>
            {[..."일월화수목금토"].map((day) => (
              <th key={day} scope="col">
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((week, index) => (
            <tr key={index}>
              {week.map((day, column) => {
                if (!day) return <td key={`empty-${column}`} />;
                const date = dateFromKey(day);
                const dayNumber = date.getDate();
                const dayMonth = date.getMonth() + 1;
                const completedDay = completed.has(day);
                const durationSeconds = durationByDate.get(day) ?? 0;
                const durationLabel = `${Math.floor(durationSeconds / 60)}분 ${durationSeconds % 60}초`;
                const future = day > today;
                const label = `${dayMonth}월 ${dayNumber}일${day === today ? " 오늘" : ""}, ${future ? "아직 오지 않은 날" : completedDay ? `운동함${selectedDate ? `, 총 ${durationLabel} 운동` : ""}` : "완료 기록 없음"}`;
                const content = (
                  <>
                    <span className={styles.dayNumber} aria-hidden="true">
                      {dayNumber}
                    </span>
                    {completedDay ? (
                      selectedDate ? (
                        <span className={styles.dayDuration} aria-hidden="true">
                          {durationLabel}
                        </span>
                      ) : (
                        <Check size={13} strokeWidth={3} aria-hidden="true" />
                      )
                    ) : (
                      <span className={styles.dayDot} aria-hidden="true" />
                    )}
                  </>
                );
                const attributes = {
                  className: styles.day,
                  "aria-current": day === today ? ("date" as const) : undefined,
                  "aria-label": label,
                  "data-completed": completedDay || undefined,
                  "data-selected": day === selectedDate || undefined,
                  "data-future": future || undefined,
                };
                return (
                  <td key={day}>
                    {completedDay && !future ? (
                      <Link {...attributes} href={`${basePath}/history/${day}`}>
                        {content}
                      </Link>
                    ) : (
                      <button {...attributes} type="button" disabled>
                        {content}
                      </button>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.legend} aria-hidden="true">
        <span>
          <Check size={14} />
          운동함
        </span>
        <span>
          <i />
          완료 기록 없음
        </span>
      </div>
    </>
  );
}

function formatWeekLabel(start: string, end: string): string {
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  if (startYear !== endYear)
    return `${startYear}년 ${startMonth}월 ${startDay}일 – ${endYear}년 ${endMonth}월 ${endDay}일`;
  if (startMonth !== endMonth)
    return `${startYear}년 ${startMonth}월 ${startDay}일 – ${endMonth}월 ${endDay}일`;
  return `${startYear}년 ${startMonth}월 ${startDay}일 – ${endDay}일`;
}
