// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ArcPredict {
    address public owner;

    struct Prediction {
        uint256 id;
        string question;
        uint256 deadline;
        bool resolved;
        bool result;
        uint256 totalYes;
        uint256 totalNo;
        mapping(address => uint256) yesAmounts;
        mapping(address => uint256) noAmounts;
        mapping(address => bool) claimed;
    }

    uint256 public predictionCount;
    mapping(uint256 => Prediction) public predictions;

    event PredictionCreated(uint256 indexed id, string question, uint256 deadline);
    event BetPlaced(uint256 indexed id, address indexed bettor, bool isYes, uint256 amount);
    event PredictionResolved(uint256 indexed id, bool result);
    event WinningsClaimed(uint256 indexed id, address indexed winner, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function createPrediction(string calldata question, uint256 deadline) external onlyOwner {
        require(deadline > block.timestamp, "Deadline must be in the future");
        uint256 id = predictionCount++;
        Prediction storage p = predictions[id];
        p.id = id;
        p.question = question;
        p.deadline = deadline;
        emit PredictionCreated(id, question, deadline);
    }

    function placeBet(uint256 predictionId, bool isYes) external payable {
        Prediction storage p = predictions[predictionId];
        require(predictionId < predictionCount, "Invalid prediction");
        require(block.timestamp < p.deadline, "Betting closed");
        require(!p.resolved, "Already resolved");
        require(msg.value > 0, "Must send funds");

        if (isYes) {
            p.yesAmounts[msg.sender] += msg.value;
            p.totalYes += msg.value;
        } else {
            p.noAmounts[msg.sender] += msg.value;
            p.totalNo += msg.value;
        }

        emit BetPlaced(predictionId, msg.sender, isYes, msg.value);
    }

    function resolvePrediction(uint256 predictionId, bool result) external onlyOwner {
        Prediction storage p = predictions[predictionId];
        require(predictionId < predictionCount, "Invalid prediction");
        require(block.timestamp >= p.deadline, "Deadline not reached");
        require(!p.resolved, "Already resolved");
        p.resolved = true;
        p.result = result;
        emit PredictionResolved(predictionId, result);
    }

    function claimWinnings(uint256 predictionId) external {
        Prediction storage p = predictions[predictionId];
        require(predictionId < predictionCount, "Invalid prediction");
        require(p.resolved, "Not resolved yet");
        require(!p.claimed[msg.sender], "Already claimed");

        uint256 userBet;
        uint256 winnerPool;
        uint256 totalPool = p.totalYes + p.totalNo;

        if (p.result) {
            userBet = p.yesAmounts[msg.sender];
            winnerPool = p.totalYes;
        } else {
            userBet = p.noAmounts[msg.sender];
            winnerPool = p.totalNo;
        }

        require(userBet > 0, "No winning bet");
        p.claimed[msg.sender] = true;

        // 2% platform fee
        uint256 payout = (userBet * totalPool * 98) / (winnerPool * 100);
        payable(msg.sender).transfer(payout);
        emit WinningsClaimed(predictionId, msg.sender, payout);
    }

    function getPrediction(uint256 id) external view returns (
        string memory question,
        uint256 deadline,
        bool resolved,
        bool result,
        uint256 totalYes,
        uint256 totalNo
    ) {
        require(id < predictionCount, "Invalid prediction");
        Prediction storage p = predictions[id];
        return (p.question, p.deadline, p.resolved, p.result, p.totalYes, p.totalNo);
    }

    function getUserBets(uint256 predictionId, address user) external view returns (uint256 yesAmount, uint256 noAmount, bool claimed) {
        Prediction storage p = predictions[predictionId];
        return (p.yesAmounts[user], p.noAmounts[user], p.claimed[user]);
    }

    function withdrawFees() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }
}
