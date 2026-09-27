"use client";
import { useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import {
  calendarWeeks,
  dateFromKey,
  shiftMonth,
} from "@/lib/workout-history-preview";
import { useWorkoutHistoryPreview } from "./workout-history-preview-provider";
import styles from "./workout-history.module.css";

export function WorkoutCalendar() {
  const { today, completed, toggleDay } = useWorkoutHistoryPreview();
  const currentMonth = today.slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [selected, setSelected] = useState(today);
  const [year, monthNumber] = month.split("-").map(Number);
  const monthLabel = `${year}년 ${monthNumber}월`;
  const count = [...completed].filter((day) => day.startsWith(month)).length;
  const selectedDate = dateFromKey(selected);
  const done = completed.has(selected);

  function changeMonth(direction: number) {
    const next = shiftMonth(month, direction);
    setMonth(next);
    setSelected(next === currentMonth ? today : `${next}-01`);
  }

  return (
    <section
      className={styles.calendar}
      aria-labelledby="workout-history-title"
    >
      <div className={styles.heading}>
        <h2 id="workout-history-title">운동 기록</h2>
        <span className={styles.previewBadge}>예시 기록</span>
      </div>
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
            setSelected(today);
          }}
        >
          오늘
        </button>
      </div>
      <table className={styles.monthGrid} aria-describedby="calendar-help">
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
                return (
                  <td key={day}>
                    <button
                      type="button"
                      className={styles.day}
                      disabled={future}
                      aria-pressed={selected === day}
                      aria-current={day === today ? "date" : undefined}
                      aria-label={`${monthNumber}월 ${dayNumber}일${day === today ? " 오늘" : ""}, ${future ? "아직 오지 않은 날" : completedDay ? "운동함" : "운동 안 함"}`}
                      data-completed={completedDay || undefined}
                      onClick={() => setSelected(day)}
                    >
                      <span className={styles.dayNumber} aria-hidden="true">
                        {dayNumber}
                      </span>
                      {completedDay ? (
                        <Check size={13} strokeWidth={3} aria-hidden="true" />
                      ) : (
                        <span className={styles.dayDot} aria-hidden="true" />
                      )}
                    </button>
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
          운동 안 함
        </span>
        <span className={styles.todayLegend}>밑줄은 오늘</span>
      </div>
      <div className={styles.selectedDay}>
        <div aria-live="polite">
          <h3>
            <time dateTime={selected}>
              {selectedDate.getMonth() + 1}월 {selectedDate.getDate()}일
            </time>
            {selected === today && <span>오늘</span>}
          </h3>
          <p>{done ? "운동 체크 완료" : "아직 운동 체크가 없어요"}</p>
        </div>
        <button
          type="button"
          className={styles.checkButton}
          aria-pressed={done}
          onClick={() => toggleDay(selected)}
        >
          <Check size={16} aria-hidden="true" />
          {done ? "체크 해제" : "운동함으로 체크"}
        </button>
      </div>
      <p className={styles.calendarHelp} id="calendar-help">
        날짜를 선택해 운동 여부를 체크해 보세요.
        <br />
        예시 기록이며, 새로고침하면 초기화돼요.
      </p>
    </section>
  );
}
