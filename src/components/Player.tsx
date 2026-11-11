"use client";

import { useRef, useState } from "react";
import { coverGradient } from "@/lib/cover";

const fmt = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");
const RATES = [1, 1.25, 1.5, 2];

/** A record that spins while its episode plays, with a tonearm that drops onto it. */
export function Vinyl({ seed, spinning, className = "" }: { seed: string; spinning: boolean; className?: string }) {
  return (
    <div className={`relative aspect-square ${className}`}>
      <div className={`vinyl h-full w-full ${spinning ? "spinning" : ""}`}>
        <div className="vinyl-label" style={{ background: coverGradient(seed) }} />
      </div>
      <div className={`tonearm ${spinning ? "down" : ""}`} aria-hidden>
        <span className="tonearm-pivot" />
      </div>
    </div>
  );
}

export function Equalizer({ on, large }: { on: boolean; large?: boolean }) {
  return (
    <span className={`eq ${large ? "eq-lg" : ""} ${on ? "on" : ""}`} aria-hidden>
      <i /><i /><i /><i /><i /><i /><i />
    </span>
  );
}

/** Custom audio player: record, play button, scrubber, speed. Starting one pauses any other. */
export default function Player({ src, seed, big }: { src: string; seed: string; big?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);

  function toggle() {
    const el = audio.current;
    if (!el) return;
    if (el.paused) {
      document.querySelectorAll("audio").forEach((a) => a !== el && a.pause());
      el.play().catch(() => {});
    } else el.pause();
  }

  function nextRate() {
    const r = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(r);
    if (audio.current) audio.current.playbackRate = r;
  }

  const pct = duration ? (time / duration) * 100 : 0;

  return (
    <div className={`flex items-center gap-4 ${big ? "flex-col sm:flex-row sm:gap-8" : ""}`}>
      <button onClick={toggle} aria-label={playing ? "Pause" : "Play"} className={`shrink-0 cursor-pointer ${big ? "w-56 sm:w-64" : "w-28 sm:w-32"}`}>
        <Vinyl seed={seed} spinning={playing} />
      </button>
      <div className="w-full min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <button
            onClick={toggle}
            aria-label={playing ? "Pause" : "Play"}
            className={`play grid shrink-0 place-items-center rounded-full bg-white text-zinc-950 ${big ? "h-14 w-14 text-xl" : "h-11 w-11"}`}
          >
            {playing ? "❚❚" : "▶"}
          </button>
          <Equalizer on={playing} large={big} />
          <button onClick={nextRate} className="btn ml-auto rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold tabular-nums text-zinc-200">
            {rate}×
          </button>
        </div>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={time}
          onChange={(e) => {
            const t = Number(e.target.value);
            setTime(t);
            if (audio.current) audio.current.currentTime = t;
          }}
          aria-label="Seek"
          className="scrub mt-4"
          style={{ ["--p" as string]: `${pct}%` }}
        />
        <div className="mt-1.5 flex justify-between text-xs tabular-nums text-zinc-500">
          <span>{fmt(time)}</span>
          <span>{duration ? fmt(duration) : "–:––"}</span>
        </div>
      </div>
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />
    </div>
  );
}
