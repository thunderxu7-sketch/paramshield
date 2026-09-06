// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Minimal mintable ERC-20 used only by the ParamShield reference market.
contract MockERC20 {
    error InsufficientAllowance();
    error InsufficientBalance();
    error InvalidAddress();
    error NotOwner();

    string public name;
    string public symbol;
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    uint8 public immutable decimals;
    uint256 public totalSupply;
    address public owner;

    mapping(address account => uint256 balance) public balanceOf;
    mapping(address account => mapping(address spender => uint256 amount)) public allowance;

    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Transfer(address indexed from, address indexed to, uint256 amount);

    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address owner_) {
        if (owner_ == address(0)) revert InvalidAddress();

        name = name_;
        symbol = symbol_;
        decimals = decimals_;
        owner = owner_;

        emit OwnershipTransferred(address(0), owner_);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        if (currentAllowance != type(uint256).max) {
            if (currentAllowance < amount) revert InsufficientAllowance();
            unchecked {
                allowance[from][msg.sender] = currentAllowance - amount;
            }
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }

        _transfer(from, to, amount);
        return true;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert InvalidAddress();

        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();

        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert InvalidAddress();

        uint256 balance = balanceOf[from];
        if (balance < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = balance - amount;
            balanceOf[to] += amount;
        }

        emit Transfer(from, to, amount);
    }

    function _checkOwner() private view {
        if (msg.sender != owner) revert NotOwner();
    }
}
