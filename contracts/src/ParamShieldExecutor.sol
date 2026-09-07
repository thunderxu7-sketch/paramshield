// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IVersionedMarket {
    function stateVersion() external view returns (uint256);
}

/// @notice Fail-closed execution gate for risk-reviewed protocol parameter changes.
contract ParamShieldExecutor {
    error CallDataTooShort();
    error RoleSeparationRequired();
    error StaleMarketState();
    error StaleAuthorizationEpoch();
    error DecisionAlreadyRecorded();
    error InvalidAddress();
    error InvalidChainId();
    error InvalidDecision();
    error InvalidEvidenceHash();
    error InvalidState();
    error InvalidTarget();
    error InvalidValue();
    error NonceAlreadyUsed();
    error NotAdmin();
    error NotDecisionAuthority();
    error NotOperator();
    error ProposalAlreadyExists();
    error ProposalExpired();
    error ProposalNotFound();
    error SelectorNotAllowed();
    error TargetCallFailed(bytes returnData);

    bytes32 public constant CHANGE_INTENT_TYPEHASH = keccak256(
        "ChangeIntentV2(address executor,address operator,uint256 chainId,address target,uint256 value,bytes32 dataHash,uint256 nonce,bytes32 evidenceHash,uint256 expectedStateVersion,uint256 expectedAuthorizationEpoch,uint64 expiresAt)"
    );
    bytes4 public constant SET_LIQUIDATION_THRESHOLD_SELECTOR =
        bytes4(keccak256("setLiquidationThresholdBps(uint16)"));

    enum Decision {
        NONE,
        ALLOW,
        BLOCK,
        ESCALATE
    }

    enum ProposalState {
        NONE,
        PENDING,
        ALLOWED,
        BLOCKED,
        ESCALATED,
        EXECUTED,
        EXPIRED
    }

    struct ChangeIntent {
        uint256 chainId;
        address target;
        uint256 value;
        bytes data;
        uint256 nonce;
        bytes32 evidenceHash;
        uint256 expectedStateVersion;
        uint256 expectedAuthorizationEpoch;
        uint64 expiresAt;
    }

    struct Proposal {
        address operator;
        address target;
        bytes4 selector;
        bytes32 dataHash;
        bytes32 evidenceHash;
        bytes32 decisionHash;
        uint256 nonce;
        uint256 expectedStateVersion;
        uint256 expectedAuthorizationEpoch;
        uint64 expiresAt;
        ProposalState state;
    }

    address public admin;
    address public operator;
    address public decisionAuthority;
    uint256 public authorizationEpoch = 1;

    mapping(bytes32 changeHash => Proposal proposal) public proposals;
    mapping(address proposer => mapping(uint256 nonce => bool used)) public nonceUsed;
    mapping(address target => mapping(bytes4 selector => bool allowed)) public allowedCalls;

    event AuthorizationEpochUpdated(uint256 authorizationEpoch);
    event ProposalPreconditions(
        bytes32 indexed changeHash, uint256 expectedStateVersion, uint256 expectedAuthorizationEpoch
    );

    event AllowedCallUpdated(address indexed target, bytes4 indexed selector, bool allowed);
    event DecisionAuthorityUpdated(
        address indexed previousDecisionAuthority, address indexed newDecisionAuthority
    );
    event DecisionRecorded(
        bytes32 indexed changeHash,
        Decision decision,
        bytes32 indexed decisionHash,
        ProposalState resultingState
    );
    event OperatorUpdated(address indexed previousOperator, address indexed newOperator);
    event OwnershipTransferred(address indexed previousAdmin, address indexed newAdmin);
    event ProposalCreated(
        bytes32 indexed changeHash,
        address indexed operator,
        address indexed target,
        bytes4 selector,
        bytes32 dataHash,
        uint256 nonce,
        bytes32 evidenceHash,
        uint64 expiresAt
    );
    event ProposalExecuted(
        bytes32 indexed changeHash, address indexed target, bytes32 returnDataHash
    );
    event ProposalMarkedExpired(bytes32 indexed changeHash);

    modifier onlyAdmin() {
        _checkAdmin();
        _;
    }

    modifier onlyDecisionAuthority() {
        _checkDecisionAuthority();
        _;
    }

    modifier onlyOperator() {
        _checkOperator();
        _;
    }

    constructor(
        address admin_,
        address operator_,
        address decisionAuthority_,
        address initialTarget_
    ) {
        if (
            admin_ == address(0) || operator_ == address(0) || decisionAuthority_ == address(0)
                || initialTarget_ == address(0)
        ) revert InvalidAddress();

        admin = admin_;
        operator = operator_;
        decisionAuthority = decisionAuthority_;
        allowedCalls[initialTarget_][SET_LIQUIDATION_THRESHOLD_SELECTOR] = true;

        emit OwnershipTransferred(address(0), admin_);
        emit OperatorUpdated(address(0), operator_);
        emit DecisionAuthorityUpdated(address(0), decisionAuthority_);
        emit AllowedCallUpdated(initialTarget_, SET_LIQUIDATION_THRESHOLD_SELECTOR, true);
    }

    function propose(ChangeIntent calldata intent)
        external
        onlyOperator
        returns (bytes32 changeHash)
    {
        bytes4 selector = _validateIntent(intent);
        if (nonceUsed[msg.sender][intent.nonce]) revert NonceAlreadyUsed();

        changeHash = hashChangeIntent(msg.sender, intent);
        if (proposals[changeHash].state != ProposalState.NONE) revert ProposalAlreadyExists();

        nonceUsed[msg.sender][intent.nonce] = true;
        proposals[changeHash] = Proposal({
            operator: msg.sender,
            target: intent.target,
            selector: selector,
            dataHash: keccak256(intent.data),
            evidenceHash: intent.evidenceHash,
            decisionHash: bytes32(0),
            nonce: intent.nonce,
            expectedStateVersion: intent.expectedStateVersion,
            expectedAuthorizationEpoch: intent.expectedAuthorizationEpoch,
            expiresAt: intent.expiresAt,
            state: ProposalState.PENDING
        });

        emit ProposalPreconditions(
            changeHash, intent.expectedStateVersion, intent.expectedAuthorizationEpoch
        );
        emit ProposalCreated(
            changeHash,
            msg.sender,
            intent.target,
            selector,
            keccak256(intent.data),
            intent.nonce,
            intent.evidenceHash,
            intent.expiresAt
        );
    }

    function recordDecision(bytes32 changeHash, Decision decision, bytes32 decisionHash)
        external
        onlyDecisionAuthority
    {
        Proposal storage proposal = proposals[changeHash];
        if (proposal.state == ProposalState.NONE) revert ProposalNotFound();
        if (proposal.state != ProposalState.PENDING) revert DecisionAlreadyRecorded();
        if (block.timestamp > proposal.expiresAt) revert ProposalExpired();
        _checkPreconditions(
            proposal.target, proposal.expectedStateVersion, proposal.expectedAuthorizationEpoch
        );
        if (decision == Decision.NONE) revert InvalidDecision();
        if (decisionHash == bytes32(0)) revert InvalidEvidenceHash();

        ProposalState resultingState;
        if (decision == Decision.ALLOW) {
            resultingState = ProposalState.ALLOWED;
        } else if (decision == Decision.BLOCK) {
            resultingState = ProposalState.BLOCKED;
        } else {
            resultingState = ProposalState.ESCALATED;
        }

        proposal.decisionHash = decisionHash;
        proposal.state = resultingState;
        emit DecisionRecorded(changeHash, decision, decisionHash, resultingState);
    }

    function execute(ChangeIntent calldata intent)
        external
        onlyOperator
        returns (bytes memory returnData)
    {
        _validateIntent(intent);
        bytes32 changeHash = hashChangeIntent(msg.sender, intent);
        Proposal storage proposal = proposals[changeHash];

        if (proposal.state == ProposalState.NONE) revert ProposalNotFound();
        if (proposal.state != ProposalState.ALLOWED) revert InvalidState();
        if (block.timestamp > proposal.expiresAt) revert ProposalExpired();

        proposal.state = ProposalState.EXECUTED;
        (bool success, bytes memory result) = intent.target.call(intent.data);
        if (!success) revert TargetCallFailed(result);

        emit ProposalExecuted(changeHash, intent.target, keccak256(result));
        return result;
    }

    function markExpired(bytes32 changeHash) external {
        Proposal storage proposal = proposals[changeHash];
        if (proposal.state == ProposalState.NONE) revert ProposalNotFound();
        if (block.timestamp <= proposal.expiresAt) revert InvalidState();
        if (
            proposal.state != ProposalState.PENDING && proposal.state != ProposalState.ALLOWED
                && proposal.state != ProposalState.ESCALATED
        ) revert InvalidState();

        proposal.state = ProposalState.EXPIRED;
        emit ProposalMarkedExpired(changeHash);
    }

    function hashChangeIntent(address intentOperator, ChangeIntent calldata intent)
        public
        view
        returns (bytes32)
    {
        bytes memory encodedIntent = abi.encode(
            CHANGE_INTENT_TYPEHASH,
            address(this),
            intentOperator,
            intent.chainId,
            intent.target,
            intent.value,
            keccak256(intent.data),
            intent.nonce,
            intent.evidenceHash,
            intent.expectedStateVersion,
            intent.expectedAuthorizationEpoch,
            intent.expiresAt
        );
        bytes32 changeHash;
        assembly ("memory-safe") {
            changeHash := keccak256(add(encodedIntent, 0x20), mload(encodedIntent))
        }
        return changeHash;
    }

    function setAllowedCall(address target, bytes4 selector, bool allowed) external onlyAdmin {
        if (target == address(0)) revert InvalidAddress();
        allowedCalls[target][selector] = allowed;
        _advanceAuthorizationEpoch();
        emit AllowedCallUpdated(target, selector, allowed);
    }

    function setOperator(address newOperator) external onlyAdmin {
        if (newOperator == address(0)) revert InvalidAddress();
        address previousOperator = operator;
        operator = newOperator;
        _advanceAuthorizationEpoch();
        emit OperatorUpdated(previousOperator, newOperator);
    }

    function setDecisionAuthority(address newDecisionAuthority) external onlyAdmin {
        if (newDecisionAuthority == address(0)) revert InvalidAddress();
        address previousDecisionAuthority = decisionAuthority;
        decisionAuthority = newDecisionAuthority;
        _advanceAuthorizationEpoch();
        emit DecisionAuthorityUpdated(previousDecisionAuthority, newDecisionAuthority);
    }

    function transferOwnership(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert InvalidAddress();
        address previousAdmin = admin;
        admin = newAdmin;
        _advanceAuthorizationEpoch();
        emit OwnershipTransferred(previousAdmin, newAdmin);
    }

    function _validateIntent(ChangeIntent calldata intent) private view returns (bytes4 selector) {
        if (intent.chainId != block.chainid) revert InvalidChainId();
        if (intent.target == address(0)) revert InvalidTarget();
        if (intent.value != 0) revert InvalidValue();
        if (intent.evidenceHash == bytes32(0)) revert InvalidEvidenceHash();
        if (block.timestamp > intent.expiresAt) revert ProposalExpired();
        if (intent.data.length < 4) revert CallDataTooShort();

        bytes calldata data = intent.data;
        assembly ("memory-safe") {
            selector := calldataload(data.offset)
        }
        if (!allowedCalls[intent.target][selector]) revert SelectorNotAllowed();
        _checkPreconditions(
            intent.target, intent.expectedStateVersion, intent.expectedAuthorizationEpoch
        );
    }

    function _advanceAuthorizationEpoch() private {
        ++authorizationEpoch;
        emit AuthorizationEpochUpdated(authorizationEpoch);
    }

    function _checkPreconditions(
        address target,
        uint256 expectedStateVersion,
        uint256 expectedAuthorizationEpoch
    ) private view {
        if (operator == decisionAuthority) {
            revert RoleSeparationRequired();
        }
        if (expectedAuthorizationEpoch != authorizationEpoch) revert StaleAuthorizationEpoch();
        if (expectedStateVersion != IVersionedMarket(target).stateVersion()) {
            revert StaleMarketState();
        }
    }

    function _checkAdmin() private view {
        if (msg.sender != admin) revert NotAdmin();
    }

    function _checkDecisionAuthority() private view {
        if (msg.sender != decisionAuthority) revert NotDecisionAuthority();
    }

    function _checkOperator() private view {
        if (msg.sender != operator) revert NotOperator();
    }
}
