'use client';

import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { createConfig, http, WagmiProvider } from 'wagmi';
import { injected } from 'wagmi/connectors';

import { robinhoodChain, SOLANA_RPC_URL } from '@/lib/config';

import '@solana/wallet-adapter-react-ui/styles.css';

export const wagmiConfig = createConfig({
	chains: [robinhoodChain],
	connectors: [injected()],
	transports: { 4663: http(), 46630: http() },
	ssr: true,
});

/** EVM (any injected / EIP-6963 wallet) and Solana (any Wallet Standard wallet) in one tree. */
export function WalletProviders({ children }: { children: React.ReactNode }) {
	const [queryClient] = useState(() => new QueryClient());
	return (
		<WagmiProvider config={wagmiConfig}>
			<QueryClientProvider client={queryClient}>
				<ConnectionProvider endpoint={SOLANA_RPC_URL} config={{ commitment: 'confirmed' }}>
					<WalletProvider wallets={[]} autoConnect>
						<WalletModalProvider>{children}</WalletModalProvider>
					</WalletProvider>
				</ConnectionProvider>
			</QueryClientProvider>
		</WagmiProvider>
	);
}
