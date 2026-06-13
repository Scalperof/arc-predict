// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract WCBetting {
    address public owner;

    struct Match {
        string homeTeam;
        string awayTeam;
        uint256 kickoff;
        bool resolved;
        uint8 result;       // 0=home, 1=draw, 2=away
        uint256 poolHome;
        uint256 poolDraw;
        uint256 poolAway;
    }

    struct UserBet {
        uint256 home;
        uint256 draw;
        uint256 away;
        bool claimed;
    }

    Match[] private _matches;
    mapping(uint256 => mapping(address => UserBet)) private _bets;

    event BetPlaced(uint256 indexed matchId, address indexed user, uint8 outcome, uint256 amount);
    event WinningsClaimed(uint256 indexed matchId, address indexed user, uint256 amount);
    event MatchAdded(uint256 indexed matchId, string homeTeam, string awayTeam, uint256 kickoff);
    event MatchResolved(uint256 indexed matchId, uint8 result);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function addMatch(string calldata homeTeam, string calldata awayTeam, uint256 kickoff) external onlyOwner {
        uint256 id = _matches.length;
        _matches.push(Match(homeTeam, awayTeam, kickoff, false, 0, 0, 0, 0));
        emit MatchAdded(id, homeTeam, awayTeam, kickoff);
    }

    function placeBet(uint256 matchId, uint8 outcome) external payable {
        require(matchId < _matches.length, "Invalid match");
        Match storage m = _matches[matchId];
        require(!m.resolved, "Already resolved");
        require(block.timestamp < m.kickoff, "Match started");
        require(outcome <= 2, "Invalid outcome");
        require(msg.value > 0, "No value sent");

        UserBet storage ub = _bets[matchId][msg.sender];
        if (outcome == 0) { m.poolHome += msg.value; ub.home += msg.value; }
        else if (outcome == 1) { m.poolDraw += msg.value; ub.draw += msg.value; }
        else { m.poolAway += msg.value; ub.away += msg.value; }

        emit BetPlaced(matchId, msg.sender, outcome, msg.value);
    }

    function resolveMatch(uint256 matchId, uint8 result) external onlyOwner {
        require(matchId < _matches.length, "Invalid match");
        Match storage m = _matches[matchId];
        require(!m.resolved, "Already resolved");
        require(result <= 2, "Invalid result");
        m.resolved = true;
        m.result = result;
        emit MatchResolved(matchId, result);
    }

    function claimWinnings(uint256 matchId) external {
        require(matchId < _matches.length, "Invalid match");
        Match storage m = _matches[matchId];
        require(m.resolved, "Not resolved");

        UserBet storage ub = _bets[matchId][msg.sender];
        require(!ub.claimed, "Already claimed");
        ub.claimed = true;

        uint256 userAmt;
        uint256 winPool;
        if (m.result == 0) { userAmt = ub.home; winPool = m.poolHome; }
        else if (m.result == 1) { userAmt = ub.draw; winPool = m.poolDraw; }
        else { userAmt = ub.away; winPool = m.poolAway; }

        require(userAmt > 0, "No winning bet");

        uint256 totalPool = m.poolHome + m.poolDraw + m.poolAway;
        uint256 winnings = (userAmt * totalPool * 98) / (winPool * 100);

        (bool ok,) = payable(msg.sender).call{value: winnings}("");
        require(ok, "Transfer failed");
        emit WinningsClaimed(matchId, msg.sender, winnings);
    }

    function getMatch(uint256 matchId) external view returns (
        string memory homeTeam, string memory awayTeam, uint256 kickoff,
        bool resolved, uint8 result,
        uint256 poolHome, uint256 poolDraw, uint256 poolAway
    ) {
        require(matchId < _matches.length, "Invalid match");
        Match storage m = _matches[matchId];
        return (m.homeTeam, m.awayTeam, m.kickoff, m.resolved, m.result, m.poolHome, m.poolDraw, m.poolAway);
    }

    function getUserBet(uint256 matchId, address user) external view returns (
        uint256 home, uint256 draw, uint256 away, bool claimed
    ) {
        UserBet storage ub = _bets[matchId][user];
        return (ub.home, ub.draw, ub.away, ub.claimed);
    }

    function matchCount() external view returns (uint256) {
        return _matches.length;
    }
}
