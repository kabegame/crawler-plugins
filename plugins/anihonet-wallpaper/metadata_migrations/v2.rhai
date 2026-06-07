// anihonet-wallpaper metadata migration v2.
//
// Goal:
// - v1 lumped every tag containing `壁紙` or `画像` into a single `qualityTags`
//   bucket. v2 separates those two senses:
//     * tags containing `画像` are quality labels      -> `qualityTags`
//     * tags containing `壁紙` are the work/series      -> `workTags`
//     * everything else stays as character labels       -> `characterTags`
// - Reclassify from the authoritative flat `tags` array so the result is
//   deterministic regardless of how v1 had split things.
//
// Historical-migration rule: this script is self-contained and must not change
// semantics once shipped. Any later fix is a new v3.rhai.

fn declared_schema(m) {
    if m["schema"] == () {
        return "";
    }
    let schema = m["schema"].to_string();
    schema.trim();
    schema
}

fn is_current_schema(m) {
    declared_schema(m) == "2"
        && m["qualityTags"] != ()
        && m["workTags"] != ()
        && m["characterTags"] != ()
}

fn tag_label(tag) {
    if tag == () {
        return "";
    }
    if tag.type_of() == "map" {
        if tag["name"] != () {
            let name = tag["name"].to_string();
            name.trim();
            if name.len() > 0 {
                return name;
            }
        }
        if tag["href"] != () {
            let href = tag["href"].to_string();
            href.trim();
            return href;
        }
    }
    let text = tag.to_string();
    text.trim();
    text
}

fn is_quality_tag(label) {
    if label == () {
        return false;
    }
    let s = label.to_string();
    s.trim();
    s.contains("高画質")
}

fn is_type_tag(label) {
    if label == () {
        return false;
    }
    let s = label.to_string();
    s.trim();

    s.contains("PC壁紙") || s.contains("Android") || s.contains("iPhone") || s.contains("スマホ")
}

fn is_work_tag(label) {
    if label == () {
        return false;
    }
    let works = [
        "アイ★チュウ", "ID-0", "IDOLY PRIDE", "アイドル", "アイマス", "蒼の彼方のフォーリズム", "赤髪の白雪姫", "アクセル・ワールド", "明日ちゃんのセーラー服", "亜人ちゃんは語りたい", "アズールレーン", "あそびあそばせ", "アニマエール！", "アブソリュート・デュオ", "甘々と稲妻", "甘城ブリリアントパーク", "アリスと蔵六", "暗殺教室", "アンジュ・ヴィエルジュ", "あんハピ♪", 
        "イジらないで、長瀞さん", "異世界おじさん", "異世界かるてっと", "異世界食堂", "異世界はスマートフォンとともに。", "異世界魔王と召喚少女の奴隷魔術", "一週間フレンズ", "異能バトルは日常系のなかで", "妹さえいればいい。", "色づく世界の明日から", "インフィニット・ストラトス", 
        "ヴァイオレット・エヴァーガーデン", "ViVid Strike!", "WIXOSS DIVA(A)LIVE", "WAVE!!〜サーフィンやっぺ!!〜", "宇崎ちゃんは遊びたい!", "うたの☆プリンスさまっ♪", "うたわれるもの", "うちの会社の小さい先輩の話", "うちのメイドがウザすぎる！", "宇宙よりも遠い場所", "ウマ娘 プリティーダービー", "裏世界ピクニック", "うらら迷路帖", "18TRIP", 
        "86-エイティシックス-", "Extreme Hearts", "SK∞ エスケーエイト", "えとたま", "Eマンガ先生", "Angel Beats!", "えんどろ〜!", 
        "Occultic;Nine-オカルティック・ナイン-", "幼なじみが絶対に負けないラブコメ", "推しが武道館いってくれたら死ぬ", "【推しの子】", "おそ松さん", "お隣の天使様にいつの間にか駄目人間にされていた件", "お兄ちゃんはおしまい!", "オルタンシア・サーガ", "俺がお嬢様学校に「庶民サンプル」として拉致られた件", "俺が好きなのは妹だけど妹じゃない", "俺だけ入れる隠しダンジョン", "俺の妹がこんなに可愛いわけがない", "orange", "終わりのセラフ", 
        
        "カードキャプターさくら", "ガーリッシュナンバー", "ガールズ&パンツァー", "ガールフレンド(仮)", "怪人開発部の黒井津さん", "ガヴリールドロップアウト", "CHAOS;CHILD(カオスチャイルド)", "学園アイドルマスター", "学戦都市アスタリスク", "かぐや様は告らせたい", "かげきしょうじょ!!", "賭ケグルイ", "がっこうぐらし！", "彼女、お借りします", "カノジョも彼女", "神様になった日", "からかい上手の高木さん", "ガラスの花と壊す世界", "可愛いだけじゃない式守さん", "艦隊これくしょん", 
        "機動戦士ガンダム 鉄血のオルフェンズ", "キノの旅", "君の名は。", "鬼滅の刃", "逆転世界ノ電池少女", "CUE!", "境界の彼方", "ギルティクラウン", "きんいろモザイク", "銀魂", 
        "空戦魔導士候補生の教官", "クズの本懐", "久保さんは僕を許さない", "くまみこ", "蜘蛛ですが、なにか?", "Classroom☆Crisis", "グラスリップ", "CLANNAD", "グランクレスト戦記", "グランブルーファンタジー", "グリザイアの果実", "SSSS.GRIDMAN", "黒子のバスケ", "クロックワーク・プラネット", "クロムクロ", 
        "けいおん!", "GATE 自衛隊 彼の地にて、斯く戦えり", "ゲーマーズ！", "ゲキドル", "月刊少女野崎くん", "月曜日のたわわ", "けものフレンズ", "現実主義勇者の王国再建記", "賢者の孫", 
        "恋×シンアイ彼女", "紅殻のパンドラ", "甲鉄城のカバネリ", "幸腹グラフィティ", "聲の形(こえのかたち)", "コードギアス", "ご注文はうさぎですか", "ゴッドイーター", "五等分の花嫁", "このはな綺譚", "この素晴らしい世界に祝福を！", "この美術部には問題がある！", "小林さんちのメイドラゴン", "ゴブリンスレイヤー", "古見さんは、コミュ症です。", "こみっくがーるず", "これはゾンビですか", "CONCEPTION", 
        
        "最弱無敗の神装機竜(バハムート)", "冴えない彼女の育てかた", "サクラクエスト", "櫻子さんの足下には", "さくら荘のペットな彼女", "サクラダリセット", "桜Trick", "3月のライオン", "三者三葉", 
        "しかのこのこのここしたんたん", "実は俺、最強でした?", "自動販売機に生まれ変わった俺は迷宮を彷徨う", "Charlotte(シャーロット)", "シャインポスト", "弱キャラ友崎くん", "灼熱の卓球娘", "Just Because!", "終末なにしてますか？忙しいですか？救ってもらっていいですか？", "呪術廻戦", "少女☆歌劇レヴュースタァライト", "少女終末旅行", "少女たちは荒野を目指す", "SHOW BY ROCK!!", "食戟のソーマ", "白い砂のアクアトープ", "白聖女と黒牧師", "白猫プロジェクト", "SHIROBAKO", "進撃の巨人", "神撃のバハムート", "人生相談テレビアニメーション「人生」", "真の仲間じゃないと勇者のパーティーを追い出されたので、辺境でスローライフすることにしました", 
        "好きな子がめがねを忘れた", "スクールガールストライカーズ", "ステラのまほう", "ストライク・ザ・ブラッド", "スパイ教室", "スロウスタート", "スローループ", 
        "青春ブタ野郎シリーズ", "聖女の魔力は万能です", "精霊幻想記", "精霊使いの剣舞", "セイレン", "世界最高の暗殺者、異世界貴族に転生する", "ゼロから始める魔法の書", "世話やきキツネの仙狐さん", "戦闘員、派遣します!", "川柳少女", 
        "装神少女まとい", "双星の陰陽師", "ソードアート・オンライン", "ソードアート・オンライン オルタナティブ ガンゲイル・オンライン", "その着せ替え人形は恋をする", "ゾン100〜ゾンビになるまでにしたい100のこと〜", "ゾンビランドサガ", 
        
        "ダーリン・イン・ザ・フランキス","天体のメソッド", "大図書館の羊飼い", "SSSS.DYNAZENON", "対魔導学園35試験小隊", "だがしかし", "盾の勇者の成り上がり", "たとえばラストダンジョン前の村の少年が序盤の街で暮らすような物語", "ダンガンロンパ", "ダンジョンに出会いを求めるのは間違っているだろうか", "探偵オペラ ミルキィホームズ", "探偵はもう、死んでいる。", 
        "チート薬師のスローライフ〜異世界に作ろうドラッグストア〜", 
        "ツインエンジェルBREAK", "つうかあ", "月がきれい", "月とライカと吸血姫", "つぐもも", "ティアムーン帝国物語〜断頭台から始まる、姫の転生逆転ストーリー〜", "D4DJ", "ディバインゲート", "Dimension W", "テイルズ オブ エクシリア", "テイルズ オブ シリーズ", "テイルズ オブ ベルセリア", "デート・ア・ライブ", "デキる猫は今日も憂鬱", "デスマーチからはじまる異世界狂想曲", "デュラララ", "天気の子", "天才王子の赤字国家再生術", "天使の3P!", "転生王女と天才令嬢の魔法革命", "転生したらスライムだった件", "天体のメソッド", 
        "とある科学の超電磁砲", "Tokyo 7th シスターズ", "刀剣乱舞", "東方Project", "ドールズフロントライン", "時々ボソッとロシア語でデレる隣のアーリャさん", "刀使ノ巫女", "ToLoveる-とらぶる-", "トリニティセブン", 
        
        "長門有希ちゃんの消失", "凪のあすから", "夏目友人帳", "なんでここに先生が!?", "ナンバカ", 
        "ニーア オートマタ", "虹色デイズ", "ニセコイ", "NEW GAME!", 
        "ネトゲの嫁は女の子じゃないと思った?", 
        "ノーゲーム・ノーライフ", "ノラガミ", "NORN9 ノルン+ノネット", "のんのんびより", 
        
        "ハイキュー!!", "ハイスクールフリート(はいふり)", "灰と幻想のグリムガル", "這いよれ!ニャル子さん", "ばくおん!!", "ハクメイとミコチ", "はたらく細胞", "バック・アロウ", "ハナヤマタ", "ハルチカ", "叛逆性ミリオンアーサー", "パンでPeace!", "ハンドシェイカー", "BanG Dream!", 
        "ひきこまり吸血姫の悶々", "ひげを剃る。そして女子高生を拾う。", "緋弾のアリア", "ひとりぼっちの○○生活", "ひなこのーと", "ヒナまつり", "響け！ユーフォニアム", "ヒプノシスマイク", "干物妹！うまるちゃん", "氷菓", "ファンタシースターオンライン2", "風夏", "フェアリーテイル", "Fateシリーズ", "武装少女マキャヴェリズム", 
        "豚のレバーは加熱しろ", "普通の女子校生が【ろこどる】やってみた", "ふらいんぐうぃっち", "プラスティック・メモリーズ", "ブラック・ブレット", "BLOOD-C", "planetarian", "プリンス・オブ・ストライド", "Free!", "プリンセス・プリンシパル", "ブルーアーカイブ -Blue Archive-", "ブルーリフレクション", "フレームアームズ・ガール", "ブレイブ・ストーリー", "ブレイブウィッチーズ", "ブレンド・S", "プロジェクトセカイ", "文豪ストレイドッグス", 
        "ヘヴィーオブジェクト", "ペルソナ4", "ペルソナ5", 
        "放課後ていぼう日誌", "VOCALOID", "僕だけがいない街", "ぼくたちのリメイク", "ぼくたちは勉強ができない", "僕の心のヤバイやつ", "僕のヒーローアカデミア", "ポケモン", "星屑テレパス", "ぼっち・ざ・ろっく!", "ポッピンQ", "ポプテピピック", "ホリミヤ", 
        
        "魔王学院の不適合者 〜史上最強の魔王の始祖、転生して子孫たちの学校へ通う〜", "マクロスΔ", "政宗くんのリベンジ", "まじもじるるも", "魔法科高校の劣等生", "魔法少女育成計画", "魔法少女まどか☆マギカ", "魔法少女リリカルなのはViVid", "迷家-マヨイガ-", 
        "見える子ちゃん", "未確認で進行形", "三ツ星カラーズ", 
        "無彩限のファントム・ワールド", "無職転生 〜異世界行ったら本気だす〜", 
        "メイドインアビス", "メルヘン・メドヘン", 
        "物語シリーズ", "モブサイコ100", "問題児たちが異世界から来るそうですよ？", 
        
        "やがて君になる", "やはり俺の青春ラブコメはまちがっている。", "ヤマノススメ", 
        "結城友奈は勇者である", "ユーリ!!! on ICE", "夢見る男子は現実主義者", "ゆゆ式", "ゆらぎ荘の幽奈さん", "ゆるキャン△", "ゆるゆり", 
        "ようこそ実力至上主義の教室へ", "幼女戦記", "弱虫ペダル", 
        
        "ラーメン大好き小泉さん", "ライアー・ライアー", "ライザのアトリエ", "らき☆すた", "ラクエンロジック", "ラピスリライツ", "ラブライブ！", "ラブライブ！サンシャイン!!", "ラブライブ！スーパースター!!", "ラブライブ！虹ヶ咲学園スクールアイドル同好会", "ラブライブ！蓮ノ空女学院スクールアイドルクラブ", "ランス・アンド・マスクス", 
        "リコリス・リコイル", "Re:ゼロから始める異世界生活", "リトルウィッチアカデミア", "りゅうおうのおしごと！", "Rewrite", "ReLIFE", "RELEASE THE SPYCE", 
        "RAIL WARS!", "レガリア The Three Sacred Stars", "Re:CREATORS(レクリエイターズ)", "恋愛暴君", "連盟空軍航空魔法音楽隊ルミナスウィッチーズ", 
        "ロクでなし魔術講師と禁忌教典", "Lostorage incited WIXOSS", 
        
        "WORKING!!", "WWW.WORKING!!", "わかばガール", "ワガママハイスペック", "私に天使が舞い降りた！", "わたしの幸せな結婚", "咲う アルスノトリア", "ワンダーエッグ・プライオリティ", "ワンパンマン", "ワンピース", "OneRoom", "ワンルーム、日当たり普通、天使つき。"
    ];
    let s = label.to_string();
    s.trim();

    if !s.contains("壁紙") {
        return false;
    }

    for work in works {
        if s.contains(work) {
            return true;
        }
    }
    return false;
}

fn copy_tag(tag) {
    if tag.type_of() == "map" {
        let name = if tag["name"] == () { "" } else { tag["name"].to_string() };
        let href = if tag["href"] == () { "" } else { tag["href"].to_string() };
        name.trim();
        href.trim();
        return #{ name: name, href: href };
    }
    let name = tag.to_string();
    name.trim();
    #{ name: name, href: "" }
}

fn split_tags(tags) {
    let quality = [];
    let work = [];
    let character = [];
    let type = [];
    if tags == () || tags.type_of() != "array" {
        return #{ qualityTags: quality, workTags: work, characterTags: character };
    }

    for tag in tags {
        let label = tag_label(tag);
        if label.len() == 0 {
            continue;
        }
        // `画像` wins over `壁紙` when a label somehow contains both, so quality
        // labels are never misfiled as a work.
        if is_work_tag(label) {
            quality.push(copy_tag(tag));
        } else if is_type_tag(label) {
            work.push(copy_tag(tag));
        } else if is_quality_tag(tag) {
            quality.push(copy_tag(tag))
        } else {
            if s.contains("壁紙") {
                work.push(copy_tag(tag));
            } else {
                character.push(copy_tag(tag));
            }
        }
    }

    #{ qualityTags: quality, workTags: work, characterTags: character, typeTags: type }
}

fn migrate(metadata) {
    let m = parse_json(metadata);
    if is_current_schema(m) {
        return to_json(m);
    }

    let out = #{ schema: 2 };
    if m["post_id"] != () {
        out["post_id"] = m["post_id"];
    }
    if m["date"] != () {
        out["date"] = m["date"];
    }
    if m["tags"] != () && m["tags"].type_of() == "array" {
        out["tags"] = m["tags"];
    } else {
        out["tags"] = [];
    }

    let split = split_tags(out["tags"]);
    out["qualityTags"] = split["qualityTags"];
    out["workTags"] = split["workTags"];
    out["characterTags"] = split["characterTags"];

    to_json(out)
}
