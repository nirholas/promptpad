'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useState } from 'react';
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from 'wagmi';

import { robinhoodChain } from '@/lib/config';
import { shortAddress } from '@/lib/format';

export function EvmWalletButton() {
	const connection = useConnection();
	const connectors = useConnectors();
	const connect = useConnect();
	const disconnect = useDisconnect();
	const switchChain = useSwitchChain();
	const [open, setOpen] = useState(false);

	if (connection.isConnected && connection.address) {
		if (connection.chainId !== robinhoodChain.id) {
			return (
				<button
					type="button"
					className="btn btn-sm"
					onClick={() => switchChain.mutate({ chainId: robinhoodChain.id })}
					disabled={switchChain.isPending}
				>
					{switchChain.isPending ? <span className="spinner" /> : null}
					switch to {robinhoodChain.name.toLowerCase()}
				</button>
			);
		}
		return (
			<button type="button" className="btn btn-sm" onClick={() => disconnect.mutate({})} title="Disconnect">
				<span className="mono">{shortAddress(connection.address)}</span>
			</button>
		);
	}

	const available = connectors.filter((c) => c.id !== 'injected' || connectors.length === 1);
	return (
		<div style={{ position: 'relative' }}>
			<button type="button" className="btn btn-sm btn-ink" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
				{connect.isPending ? <span className="spinner" /> : null}
				connect evm wallet
			</button>
			{open ? (
				<div className="card" style={{ position: 'absolute', right: 0, top: 42, zIndex: 20, padding: 8, minWidth: 220, display: 'grid', gap: 4 }}>
					{available.length ? (
						available.map((connector) => (
							<button
								key={connector.uid}
								type="button"
								className="btn btn-ghost btn-sm"
								style={{ justifyContent: 'flex-start' }}
								onClick={() => {
									setOpen(false);
									connect.mutate({ connector, chainId: robinhoodChain.id });
								}}
							>
								{connector.icon ? (
									// eslint-disable-next-line @next/next/no-img-element
									<img src={connector.icon} alt="" width={18} height={18} />
								) : null}
								{connector.name.toLowerCase()}
							</button>
						))
					) : (
						<p className="muted" style={{ padding: 8, fontSize: 14 }}>
							no browser wallet found. install metamask, rabby or any evm wallet.
						</p>
					)}
				</div>
			) : null}
			{connect.error ? (
				<p className="muted" style={{ fontSize: 12.5, marginTop: 6, color: 'var(--bad)' }}>
					{connect.error.message.split('\n')[0]}
				</p>
			) : null}
		</div>
	);
}

export function SolanaWalletButton() {
	const wallet = useWallet();
	const modal = useWalletModal();
	if (wallet.publicKey) {
		return (
			<button type="button" className="btn btn-sm" onClick={() => wallet.disconnect()} title="Disconnect">
				<span className="mono">{shortAddress(wallet.publicKey.toBase58())}</span>
			</button>
		);
	}
	return (
		<button type="button" className="btn btn-sm btn-ink" onClick={() => modal.setVisible(true)}>
			{wallet.connecting ? <span className="spinner" /> : null}
			connect solana wallet
		</button>
	);
}
