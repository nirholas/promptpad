'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

export type HeroFact = { label: string; value: string };
export type HeroSlide = {
	id: string;
	eyebrow: string;
	title: string;
	body: string;
	cta: { href: string; label: string };
	secondary?: { href: string; label: string };
	visual: { kind: 'terminal'; lines: { you: string; out: string } } | { kind: 'facts'; facts: HeroFact[]; note: string };
};

const ROTATE_MS = 8_000;

/** The banner: copy on the left, a visual on the right, advancing on its own until you interact. */
export function HeroCarousel({ slides }: { slides: HeroSlide[] }) {
	const [index, setIndex] = useState(0);
	const [paused, setPaused] = useState(false);
	const slide = slides[index];
	const go = useCallback((delta: number) => setIndex((i) => (i + delta + slides.length) % slides.length), [slides.length]);

	useEffect(() => {
		if (paused || slides.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const timer = setInterval(() => go(1), ROTATE_MS);
		return () => clearInterval(timer);
	}, [paused, go, slides.length]);

	return (
		<section
			className="card hero-banner"
			aria-roledescription="carousel"
			aria-label="Highlights"
			onMouseEnter={() => setPaused(true)}
			onMouseLeave={() => setPaused(false)}
			onFocusCapture={() => setPaused(true)}
			onKeyDown={(e) => {
				if (e.key === 'ArrowRight') go(1);
				if (e.key === 'ArrowLeft') go(-1);
			}}
		>
			<div className="hero-copy" key={`copy-${slide.id}`} aria-live="polite">
				<span className="eyebrow">{slide.eyebrow}</span>
				<h1>{slide.title}</h1>
				<p>{slide.body}</p>
				<div className="cta-row">
					<Link href={slide.cta.href} className="btn btn-primary btn-lg">
						{slide.cta.label}
					</Link>
					{slide.secondary ? (
						<Link href={slide.secondary.href} className="btn btn-lg">
							{slide.secondary.label}
						</Link>
					) : null}
				</div>
			</div>
			<div className="hero-visual">
				<div className="slide" key={`visual-${slide.id}`}>
					{slide.visual.kind === 'terminal' ? (
						<div className="terminal">
							<div className="terminal-bar">
								<i />
								<i />
								<i />
								<span className="caps">claude · example</span>
							</div>
							<div className="terminal-body">
								<p className="you">{slide.visual.lines.you}</p>
								<p className="out">{slide.visual.lines.out}</p>
							</div>
						</div>
					) : (
						<div className="fact-grid">
							{slide.visual.facts.map((f) => (
								<div key={f.label}>
									<span className="caps">{f.label}</span>
									<strong>{f.value}</strong>
								</div>
							))}
							<div className="wide">{slide.visual.note}</div>
						</div>
					)}
				</div>
				{slides.length > 1 ? (
					<div className="carousel-controls">
						<button type="button" aria-label="Previous slide" onClick={() => go(-1)}>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
						</button>
						<div className="dots">
							{slides.map((s, i) => (
								<button key={s.id} type="button" aria-label={`Slide ${i + 1}: ${s.eyebrow}`} aria-current={i === index} onClick={() => setIndex(i)} style={{ all: 'unset', cursor: 'pointer' }}>
									<span style={{ display: 'block', width: i === index ? 22 : 6, height: 6, borderRadius: 999, background: i === index ? 'var(--ink)' : 'var(--ink-4)', transition: 'width .2s' }} />
								</button>
							))}
						</div>
						<button type="button" aria-label="Next slide" onClick={() => go(1)}>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
						</button>
					</div>
				) : null}
			</div>
		</section>
	);
}
