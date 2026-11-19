-- 042 dynamic Elo settlement (1v1 arena / ranked)
DROP PROCEDURE IF EXISTS settle_ranked_match;
DELIMITER $$
CREATE PROCEDURE settle_ranked_match(IN p_match_id BIGINT UNSIGNED, IN p_winner VARCHAR(1))
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE v_user BIGINT UNSIGNED;
  DECLARE v_team VARCHAR(1);
  DECLARE v_rating INT;
  DECLARE v_after INT;
  DECLARE v_afk TINYINT DEFAULT 0;
  DECLARE v_status VARCHAR(16) DEFAULT '';
  DECLARE v_opponent INT;
  DECLARE v_opponent_rating INT;
  DECLARE v_opponent_afk TINYINT DEFAULT 0;
  DECLARE v_own_matches INT DEFAULT 0;
  DECLARE v_pair_count INT DEFAULT 0;
  DECLARE v_expected DECIMAL(8,6) DEFAULT 0.5;
  DECLARE v_mult DECIMAL(4,2) DEFAULT 1.00;
  DECLARE v_k INT DEFAULT 24;
  DECLARE v_win TINYINT DEFAULT 0;
  DECLARE v_delta INT DEFAULT 0;
  DECLARE total_pool INT DEFAULT 0;
  DECLARE winning_pool INT DEFAULT 0;
  DECLARE cur CURSOR FOR
    SELECT user_id, team, rating_before, afk FROM ranked_match_players WHERE match_id = p_match_id;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  SELECT status INTO v_status FROM ranked_matches WHERE id = p_match_id FOR UPDATE;
  IF v_status IN ('waiting','live') THEN
    UPDATE ranked_matches
       SET status = 'finished', winner = p_winner, finished_at = NOW()
     WHERE id = p_match_id AND status IN ('waiting','live');

    OPEN cur;
    player_loop: LOOP
      FETCH cur INTO v_user, v_team, v_rating, v_afk;
      IF done THEN LEAVE player_loop; END IF;

      SET v_win = IF(v_team = p_winner, 1, 0);
      SET v_opponent = 0;
      SET v_opponent_rating = v_rating;
      SET v_opponent_afk = 0;
      SELECT user_id, rating_before, afk INTO v_opponent, v_opponent_rating, v_opponent_afk
        FROM ranked_match_players
       WHERE match_id = p_match_id AND user_id <> v_user
       LIMIT 1;

      SELECT COALESCE(matches, 0) INTO v_own_matches
        FROM ranked_profiles WHERE user_id = v_user LIMIT 1;

      SELECT COUNT(*) INTO v_pair_count
        FROM ranked_matches m
        JOIN ranked_match_players p2 ON p2.match_id = m.id AND p2.user_id = v_opponent
       WHERE m.id <> p_match_id AND m.status = 'finished' AND m.winner IS NOT NULL
         AND m.finished_at > (NOW() - INTERVAL 24 HOUR)
         AND EXISTS (
           SELECT 1 FROM ranked_match_players p1
            WHERE p1.match_id = m.id AND p1.user_id = v_user
         );

      SET v_k = CASE
        WHEN v_own_matches < 10 THEN 40
        WHEN v_rating >= 2200 THEN 8
        WHEN v_rating >= 1800 THEN 16
        ELSE 24
      END;
      SET v_mult = CASE
        WHEN v_pair_count = 0 THEN 1.00
        WHEN v_pair_count = 1 THEN 0.60
        WHEN v_pair_count = 2 THEN 0.30
        ELSE 0.00
      END;
      SET v_expected = 1 / (1 + POW(10, (v_opponent_rating - v_rating) / 400));
      SET v_delta = ROUND(v_k * (v_win - v_expected) * v_mult);

      IF v_win = 1 THEN
        SET v_delta = GREATEST(1, LEAST(40, v_delta));
      ELSE
        SET v_delta = LEAST(-1, GREATEST(-40, v_delta));
      END IF;

      IF v_afk = 1 AND v_win = 0 THEN
        SET v_delta = -30;
      ELSEIF v_opponent_afk = 1 AND v_win = 1 THEN
        SET v_delta = 10;
      END IF;

      IF v_mult = 0 AND v_afk = 0 AND v_opponent_afk = 0 THEN
        SET v_delta = 0;
      END IF;

      SET v_after = GREATEST(0, v_rating + v_delta);
      UPDATE ranked_match_players SET rating_after = v_after
       WHERE match_id = p_match_id AND user_id = v_user;
      INSERT IGNORE INTO ranked_profiles (user_id, rating) VALUES (v_user, v_rating);
      UPDATE ranked_profiles
         SET rating = v_after,
             wins = wins + v_win,
             losses = losses + (1 - v_win),
             matches = matches + 1
       WHERE user_id = v_user;
    END LOOP;
    CLOSE cur;

    SELECT COALESCE(SUM(amount), 0) INTO total_pool
      FROM ranked_bets WHERE match_id = p_match_id AND settled = 0;
    SELECT COALESCE(SUM(CASE WHEN team = p_winner THEN amount ELSE 0 END), 0) INTO winning_pool
      FROM ranked_bets WHERE match_id = p_match_id AND settled = 0;

    IF winning_pool = 0 THEN
      INSERT IGNORE INTO wallets (user_id)
        SELECT user_id FROM ranked_bets WHERE match_id = p_match_id AND settled = 0;
      UPDATE wallets w JOIN ranked_bets b ON b.user_id = w.user_id
         SET w.coins = w.coins + b.amount
       WHERE b.match_id = p_match_id AND b.settled = 0;
      INSERT INTO coin_transactions (user_id, amount, reason)
        SELECT user_id, amount, 'ranked_refund'
          FROM ranked_bets WHERE match_id = p_match_id AND settled = 0;
      UPDATE ranked_bets SET settled = 1, payout = amount
       WHERE match_id = p_match_id AND settled = 0;
    ELSE
      INSERT IGNORE INTO wallets (user_id)
        SELECT user_id FROM ranked_bets WHERE match_id = p_match_id AND settled = 0;
      UPDATE wallets w JOIN ranked_bets b ON b.user_id = w.user_id
         SET w.coins = w.coins + FLOOR(b.amount * total_pool * 0.95 / winning_pool)
       WHERE b.match_id = p_match_id AND b.settled = 0 AND b.team = p_winner;
      INSERT INTO coin_transactions (user_id, amount, reason)
        SELECT user_id, FLOOR(amount * total_pool * 0.95 / winning_pool), 'ranked_win'
          FROM ranked_bets WHERE b.match_id = p_match_id AND b.settled = 0 AND b.team = p_winner;
      UPDATE ranked_bets
         SET settled = 1,
             payout = IF(team = p_winner, FLOOR(amount * total_pool * 0.95 / winning_pool), 0)
       WHERE match_id = p_match_id AND settled = 0;
    END IF;
  END IF;
END$$
DELIMITER ;