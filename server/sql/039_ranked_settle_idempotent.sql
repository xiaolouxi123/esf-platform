-- 039: make ranked settlement idempotent so platform leave and plugin AFK cannot double-apply.
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
        DECLARE total_pool INT DEFAULT 0;
        DECLARE winning_pool INT DEFAULT 0;
        DECLARE cur CURSOR FOR
          SELECT user_id, team, rating_before, afk FROM ranked_match_players WHERE match_id = p_match_id;
        DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

        -- 幂等：插件/平台/管理员可能同时结算同一场，只有第一次生效。
        SELECT status INTO v_status FROM ranked_matches WHERE id = p_match_id FOR UPDATE;
        IF v_status IN ('waiting','live') THEN
          UPDATE ranked_matches
             SET status = 'finished', winner = p_winner, finished_at = NOW()
           WHERE id = p_match_id AND status IN ('waiting','live');

          OPEN cur;
          player_loop: LOOP
            FETCH cur INTO v_user, v_team, v_rating, v_afk;
            IF done THEN LEAVE player_loop; END IF;
            IF v_team = p_winner THEN
              SET v_after = v_rating + 25;
            ELSEIF v_afk = 1 THEN
              SET v_after = GREATEST(0, v_rating - 30);
            ELSE
              SET v_after = GREATEST(0, v_rating - 20);
            END IF;
            UPDATE ranked_match_players SET rating_after = v_after
             WHERE match_id = p_match_id AND user_id = v_user;
            INSERT IGNORE INTO ranked_profiles (user_id, rating) VALUES (v_user, v_rating);
            UPDATE ranked_profiles
               SET rating = v_after,
                   wins = wins + IF(v_team = p_winner, 1, 0),
                   losses = losses + IF(v_team = p_winner, 0, 1),
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
                FROM ranked_bets WHERE match_id = p_match_id AND settled = 0 AND team = p_winner;
            UPDATE ranked_bets
               SET settled = 1,
                   payout = IF(team = p_winner, FLOOR(amount * total_pool * 0.95 / winning_pool), 0)
             WHERE match_id = p_match_id AND settled = 0;
          END IF;
        END IF;
      END
$$
DELIMITER ;
