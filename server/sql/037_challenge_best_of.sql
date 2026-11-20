-- 037: 约战支持 BO1 / BO3
-- best_of = 1 一局定胜负；best_of = 3 三局两胜（先到 2 胜）

-- best_of 列由 scripts/migrate.js 的 ensureColumn 补（本文件会被反复执行）
DROP PROCEDURE IF EXISTS report_challenge_round;

CREATE PROCEDURE report_challenge_round(
  IN p_room_id BIGINT UNSIGNED,
  IN p_winner VARCHAR(1),
  IN p_score_a INT,
  IN p_score_b INT
)
BEGIN
  DECLARE v_status VARCHAR(16) DEFAULT '';
  DECLARE v_round INT UNSIGNED DEFAULT 1;
  DECLARE v_best INT DEFAULT 3;
  DECLARE v_target INT DEFAULT 2;
  DECLARE v_wins_a INT DEFAULT 0;
  DECLARE v_wins_b INT DEFAULT 0;
  DECLARE v_final VARCHAR(1) DEFAULT 'a';

  SELECT status, round_no, best_of INTO v_status, v_round, v_best
    FROM challenge_rooms WHERE id = p_room_id;

  SET v_best = IFNULL(v_best, 3);
  SET v_target = IF(v_best <= 1, 1, 2);

  IF v_status IS NULL OR v_status <> 'live' THEN
    SELECT 0 AS finished, v_round AS round_no, 0 AS wins_a, 0 AS wins_b, NULL AS final_winner, v_best AS best_of;
  ELSE
    INSERT INTO challenge_rounds (room_id, round_no, winner, score_a, score_b)
    VALUES (p_room_id, v_round, p_winner, p_score_a, p_score_b)
    ON DUPLICATE KEY UPDATE
      winner = VALUES(winner), score_a = VALUES(score_a), score_b = VALUES(score_b);

    SELECT COUNT(*) INTO v_wins_a FROM challenge_rounds WHERE room_id = p_room_id AND winner = 'a';
    SELECT COUNT(*) INTO v_wins_b FROM challenge_rounds WHERE room_id = p_room_id AND winner = 'b';

    IF v_wins_a >= v_target OR v_wins_b >= v_target THEN
      SET v_final = IF(v_wins_a > v_wins_b, 'a', 'b');
      INSERT INTO challenge_results
        (room_id, winner, score_a, score_b, victory_type, victory_limit, ended_at)
      VALUES (p_room_id, v_final, v_wins_a, v_wins_b, 'series', v_target, NOW())
      ON DUPLICATE KEY UPDATE
        winner = VALUES(winner), score_a = VALUES(score_a), score_b = VALUES(score_b),
        victory_type = VALUES(victory_type), victory_limit = VALUES(victory_limit),
        ended_at = VALUES(ended_at);
      UPDATE challenge_rooms SET status = 'closed', closed_at = NOW()
       WHERE id = p_room_id AND status = 'live';
      SELECT 1 AS finished, v_round AS round_no, v_wins_a AS wins_a, v_wins_b AS wins_b, v_final AS final_winner, v_best AS best_of;
    ELSE
      UPDATE challenge_rooms SET round_no = v_round + 1 WHERE id = p_room_id;
      SELECT 0 AS finished, v_round AS round_no, v_wins_a AS wins_a, v_wins_b AS wins_b, NULL AS final_winner, v_best AS best_of;
    END IF;
  END IF;
END
