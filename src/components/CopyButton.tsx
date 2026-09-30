'use client';

import { useState } from 'react';

import { CheckIcon, CopyIcon } from './HeaderControls';

/** Copy-to-clipboard button. `icon` renders a bare glyph (with `label` as its accessible name). */
export function CopyButton({
	value,
	label = 'copy',
	className = 'btn btn-sm',
	icon = false,
}: {
	value: string;
	label?: string;
	className?: string;
	icon?: boolean;
}) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			className={className}
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(value);
					setCopied(true);
					setTimeout(() => setCopied(false), 1600);
				} catch {
					window.prompt('Copy this:', value);
				}
			}}
			aria-live="polite"
			aria-label={icon ? label : undefined}
		>
			{icon ? copied ? <CheckIcon /> : <CopyIcon /> : copied ? 'copied' : label}
		</button>
	);
}
