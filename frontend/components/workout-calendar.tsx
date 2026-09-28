"use client";
import Link from "next/link";
import { useWorkoutHistoryLinks } from "./use-workout-history-links";
import { useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { calendarWeeks, dateFromKey, shiftMonth } from "@/lib/workout-history";
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
      <div className={styles.heading}>
        <h2 id="workout-history-title">운동 기록</h2>
      </div>
      {!ready || error ? (
        <WorkoutHistoryFeedback />
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

  const { today, completed } = useWorkoutHistory();
  const currentMonth = today.slice(0, 7);
  const [month, setMonth] = useState(selectedDate?.slice(0, 7) ?? currentMonth);
  const [year, monthNumber] = month.split("-").map(Number);
  const monthLabel = `${year}년 ${monthNumber}월`;
  const count = [...completed].filter((day) => day.startsWith(month)).length;

  function changeMonth(direction: number) {
    const next = shiftMonth(month, direction);
    setMonth(next);
  }

  return (
    <>
      <div className={styles.monthNavigation}>
        <button
          type="button"
          className="icon-button"
          aria-label="이전 달"
          onClick={() => changeMonth(-1)}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <h3 aria-live="polite">{monthLabel}</h3>
        <button
          type="button"
          className="icon-button"
          aria-label="다음 달"
          disabled={month >= currentMonth}
          onClick={() => changeMonth(1)}
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>
      <div className={styles.monthSummary}>
        <p>
          <strong>{count}일</strong> 운동했어요
        </p>
        <button
          type="button"
          onClick={() => {
            setMonth(currentMonth);
          }}
        >
          오늘
        </button>
      </div>
      <table className={styles.monthGrid}>
        <caption className="sr-only">{monthLabel} 운동 기록</caption>
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
          {calendarWeeks(month).map((week, index) => (
            <tr key={index}>
              {week.map((day, column) => {
                if (!day) return <td key={`empty-${column}`} />;
                const dayNumber = dateFromKey(day).getDate();
                const completedDay = completed.has(day);
                const future = day > today;
                const label = `${monthNumber}월 ${dayNumber}일${day === today ? " 오늘" : ""}, ${future ? "아직 오지 않은 날" : completedDay ? "운동함" : "완료 기록 없음"}`;
                const content = (
                  <>
                    <span className={styles.dayNumber} aria-hidden="true">
                      {dayNumber}
                    </span>
                    {completedDay ? (
                      <Check size={13} strokeWidth={3} aria-hidden="true" />
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
