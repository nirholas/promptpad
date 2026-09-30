'use client';

import { useState } from 'react';

export function CopyButton({ value, label = 'copy', className = 'btn btn-sm' }: { value: string; label?: string; className?: string }) {
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
		>
			{copied ? 'copied' : label}
		</button>
	);
}
