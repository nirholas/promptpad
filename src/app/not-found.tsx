import Link from 'next/link';

export default function NotFound() {
	return (
		<div className="wrap" style={{ paddingTop: 80 }}>
			<div className="empty">
				<h3>nothing here</h3>
				<p>that page, token or launch does not exist on this site. it may be on a different chain, or the link was cut short.</p>
				<div className="cta-row" style={{ justifyContent: 'center' }}>
					<Link href="/registry" className="btn">
						search the registry
					</Link>
					<Link href="/" className="btn btn-ink">
						go home
					</Link>
				</div>
			</div>
		</div>
	);
}
