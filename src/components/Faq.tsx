export type FaqItem = { q: string; a: React.ReactNode };

export function Faq({ items }: { items: FaqItem[] }) {
	return (
		<div className="faq">
			{items.map((item) => (
				<details key={item.q}>
					<summary>{item.q}</summary>
					<div>{item.a}</div>
				</details>
			))}
		</div>
	);
}
