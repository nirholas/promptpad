// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @title PadToken
/// @notice Fixed-supply ERC20 minted once, in full, to the launch factory's bonding curve.
/// No owner, no mint, no tax, no blacklist. Metadata is written at birth and never changes.
contract PadToken is ERC20, ERC20Burnable {
    /// @notice The factory that runs this token's bonding curve.
    address public immutable factory;
    /// @notice Wallet that launched the token.
    address public immutable creator;

    string public image;
    string public description;

    constructor(
        string memory name_,
        string memory symbol_,
        string memory image_,
        string memory description_,
        address creator_,
        uint256 supply
    ) ERC20(name_, symbol_) {
        factory = msg.sender;
        creator = creator_;
        image = image_;
        description = description_;
        _mint(msg.sender, supply);
    }

    /// @dev The factory can only ever move tokens out of `msg.sender` in `sell`, so granting it a
    /// standing allowance saves every seller an approval transaction without widening trust.
    function allowance(address owner, address spender) public view override returns (uint256) {
        if (spender == factory) return type(uint256).max;
        return super.allowance(owner, spender);
    }

    function _spendAllowance(address owner, address spender, uint256 value) internal override {
        if (spender == factory) return;
        super._spendAllowance(owner, spender, value);
    }
}
