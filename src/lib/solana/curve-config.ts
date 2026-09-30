import {
	ActivationType,
	BaseFeeMode,
	buildCurve,
	CollectFeeMode,
	MigrationFeeOption,
	MigrationOption,
	TokenAuthorityOption,
	TokenDecimal,
	TokenType,
	type ConfigParameters,
} from '@meteora-ag/dynamic-bonding-curve-sdk';

/**
 * The single source of truth for the Solana launch economics. `scripts/solana-create-config.ts`
 * writes exactly this on-chain as the partner config, and the site renders its fee table from the
 * same numbers, so the page can never drift from the chain.
 */
export const SOLANA_ECONOMICS = {
	totalSupply: 1_000_000_000,
	decimals: 6,
	/** SOL raised on the curve before the pool migrates to Meteora DAMM v2. */
	migrationQuoteThresholdSol: 85,
	/** Share of supply that seeds the DAMM v2 pool at migration. */
	percentageSupplyOnMigration: 20,
	/** Flat SOL charged to the launcher when the pool is created (Meteora keeps 10%). Pons-level. */
	launchFeeSol: 0.01,
	/** Steady-state trade fee once the anti-snipe window has passed: 1%, as on Pons. */
	tradeFeeBps: 100,
	/** Opening trade fee of 99%, decaying to `tradeFeeBps` over `antiSnipeSeconds` (Pons: 5s). */
	antiSnipeStartBps: 9_900,
	antiSnipeSeconds: 5,
	/** Creator share of the partner's trading fee: the Pons 70 / 30 split. */
	creatorTradingFeePercentage: 70,
	/** No graduation fee, as on Pons. */
	migrationFeePercentage: 0,
	/** Permanently locked LP at migration, 70 / 30 like the trade fee; each side claims its own LP fees. */
	partnerLockedLpPercentage: 30,
	creatorLockedLpPercentage: 70,
	/** Meteora's protocol cut of every trading fee (fixed by the program). */
	meteoraProtocolFeePercentage: 20,
} as const;

export function buildPartnerConfig(): ConfigParameters {
	const e = SOLANA_ECONOMICS;
	return buildCurve({
		token: {
			tokenType: TokenType.SPLToken,
			tokenBaseDecimal: TokenDecimal.SIX,
			tokenQuoteDecimal: 9,
			tokenAuthorityOption: TokenAuthorityOption.Immutable,
			totalTokenSupply: e.totalSupply,
			leftover: 0,
		},
		fee: {
			baseFeeParams: {
				baseFeeMode: BaseFeeMode.FeeSchedulerExponential,
				feeSchedulerParam: {
					startingFeeBps: e.antiSnipeStartBps,
					endingFeeBps: e.tradeFeeBps,
					numberOfPeriod: e.antiSnipeSeconds,
					totalDuration: e.antiSnipeSeconds,
				},
			},
			dynamicFeeEnabled: true,
			collectFeeMode: CollectFeeMode.QuoteToken,
			creatorTradingFeePercentage: e.creatorTradingFeePercentage,
			poolCreationFee: e.launchFeeSol,
			enableFirstSwapWithMinFee: true,
		},
		migration: {
			migrationOption: MigrationOption.MET_DAMM_V2,
			migrationFeeOption: MigrationFeeOption.FixedBps100,
			migrationFee: { feePercentage: e.migrationFeePercentage, creatorFeePercentage: 0 },
		},
		liquidityDistribution: {
			partnerPermanentLockedLiquidityPercentage: e.partnerLockedLpPercentage,
			partnerLiquidityPercentage: 0,
			creatorPermanentLockedLiquidityPercentage: e.creatorLockedLpPercentage,
			creatorLiquidityPercentage: 0,
		},
		lockedVesting: {
			totalLockedVestingAmount: 0,
			numberOfVestingPeriod: 0,
			cliffUnlockAmount: 0,
			totalVestingDuration: 0,
			cliffDurationFromMigrationTime: 0,
		},
		activationType: ActivationType.Timestamp,
		percentageSupplyOnMigration: e.percentageSupplyOnMigration,
		migrationQuoteThreshold: e.migrationQuoteThresholdSol,
	});
}
