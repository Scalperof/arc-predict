// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract WorldCupBet {
    address public owner;
    uint256 public matchCount;
    uint256 public constant FEE_NUM = 2;
    uint256 public constant FEE_DEN = 100;

    struct Match {
        string homeTeam;
        string awayTeam;
        uint256 kickoff;
        bool resolved;
        uint8 result;      // 0=ev sahibi 1=beraberlik 2=deplasman 255=bekliyor
        uint256 poolHome;
        uint256 poolDraw;
        uint256 poolAway;
        uint256 externalId;
    }

    struct UserBet {
        uint256 home;
        uint256 draw;
        uint256 away;
        bool claimed;
    }

    mapping(uint256 => Match) public matches;
    mapping(uint256 => mapping(address => UserBet)) public userBets;
    mapping(uint256 => bool) public fixtureCreated;

    event MatchCreated(uint256 indexed id, string homeTeam, string awayTeam, uint256 kickoff);
    event BetPlaced(uint256 indexed matchId, address indexed user, uint8 outcome, uint256 amount);
    event MatchResolved(uint256 indexed matchId, uint8 result);
    event WinningsClaimed(uint256 indexed matchId, address indexed user, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function createMatch(
        string calldata homeTeam,
        string calldata awayTeam,
        uint256 kickoff,
        uint256 externalId
    ) external onlyOwner returns (uint256 id) {
        require(kickoff > block.timestamp, "Kickoff gecmiste");
        if (externalId > 0) {
            require(!fixtureCreated[externalId], "Fiktur zaten olusturuldu");
            fixtureCreated[externalId] = true;
        }
        id = matchCount++;
        Match storage m = matches[id];
        m.homeTeam = homeTeam;
        m.awayTeam = awayTeam;
        m.kickoff = kickoff;
        m.result = 255;
        m.externalId = externalId;
        emit MatchCreated(id, homeTeam, awayTeam, kickoff);
    }

    function placeBet(uint256 matchId, uint8 outcome) external payable {
        require(matchId < matchCount, "Gecersiz mac");
        require(outcome < 3, "Gecersiz secim: 0=ev 1=beraberlik 2=deplasman");
        require(msg.value > 0, "Sifir deger");
        Match storage m = matches[matchId];
        require(!m.resolved, "Mac cozumlendi");
        require(block.timestamp < m.kickoff, "Bahis kapali");

        UserBet storage b = userBets[matchId][msg.sender];
        if (outcome == 0) { m.poolHome += msg.value; b.home += msg.value; }
        else if (outcome == 1) { m.poolDraw += msg.value; b.draw += msg.value; }
        else { m.poolAway += msg.value; b.away += msg.value; }

        emit BetPlaced(matchId, msg.sender, outcome, msg.value);
    }

    function resolveMatch(uint256 matchId, uint8 result) external onlyOwner {
        require(matchId < matchCount, "Gecersiz mac");
        require(result < 3, "Gecersiz sonuc");
        Match storage m = matches[matchId];
        require(!m.resolved, "Zaten cozumlendi");
        require(block.timestamp >= m.kickoff, "Mac baslamadi");
        m.resolved = true;
        m.result = result;
        emit MatchResolved(matchId, result);
    }

    function claimWinnings(uint256 matchId) external {
        Match storage m = matches[matchId];
        require(m.resolved, "Henuz cozumlenmedi");
        UserBet storage b = userBets[matchId][msg.sender];
        require(!b.claimed, "Zaten alindi");

        uint256 userAmount;
        uint256 winPool;
        if (m.result == 0)      { userAmount = b.home; winPool = m.poolHome; }
        else if (m.result == 1) { userAmount = b.draw; winPool = m.poolDraw; }
        else                    { userAmount = b.away; winPool = m.poolAway; }

        require(userAmount > 0, "Kazanan bahis yok");
        b.claimed = true;

        uint256 totalPool = m.poolHome + m.poolDraw + m.poolAway;
        uint256 gross = (userAmount * totalPool) / winPool;
        uint256 fee = (gross * FEE_NUM) / FEE_DEN;
        uint256 net = gross - fee;

        if (fee > 0) payable(owner).transfer(fee);
        payable(msg.sender).transfer(net);
        emit WinningsClaimed(matchId, msg.sender, net);
    }

    function getMatch(uint256 matchId) external view returns (
        string memory homeTeam,
        string memory awayTeam,
        uint256 kickoff,
        bool resolved,
        uint8 result,
        uint256 poolHome,
        uint256 poolDraw,
        uint256 poolAway
    ) {
        Match storage m = matches[matchId];
        return (m.homeTeam, m.awayTeam, m.kickoff, m.resolved, m.result, m.poolHome, m.poolDraw, m.poolAway);
    }

    function getUserBet(uint256 matchId, address user) external view returns (
        uint256 home, uint256 draw, uint256 away, bool claimed
    ) {
        UserBet storage b = userBets[matchId][user];
        return (b.home, b.draw, b.away, b.claimed);
    }

    function withdrawFees() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }
}
