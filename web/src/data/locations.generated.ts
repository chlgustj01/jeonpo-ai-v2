// AUTO-EXTRACTED from index.html's `locations` demo map data.
/* eslint-disable */
export const locations = [
      {
        id: 0,
        name: "Jeonpo Solgup Samgyeopsal",
        nameKo: "전포 솥굽 삼겹살",
        category: "restaurant",
        categoryDisplay: { en: "KOREAN RESTAURANT", ja: "韓国焼肉・食堂", zh: "韩式烤肉店", vi: "Nhà Hàng Đồ Nướng", es: "RESTAURANTE COREANO", ko: "한식 고깃집" },
        rating: "4.8",
        desc: {
          en: "Traditional Korean Pork belly grilled on a rustic iron cauldron lid with ripe Kimchi and wild vegetables.",
          ja: "伝統的な鉄釜の蓋で焼く熟成サムギョプサル。熟成キムチやワラビと一緒に楽しめます。",
          zh: "传统的铁锅盖烤五花肉，配上陈年泡菜、蕨菜等一同烤制，是田浦著名的聚餐首选。",
          vi: "Thịt ba chỉ nướng trên nắp vung gang truyền thống cùng kim chi chín và rau dại.",
          es: "Panceta de cerdo coreana tradicional asada en una tapa de caldero de hierro con Kimchi maduro.",
          ko: "투박한 무쇠솥 뚜껑에 구운 전통 삼겹살에, 잘 익은 김치와 제철 나물을 곁들여 즐기는 메뉴입니다."
        },
        mainDish: { en: "Samgyeopsal Set", ja: "サムギョプサルセット", zh: "五花肉套餐", vi: "Set Ba Chỉ Nướng", es: "Set de Samgyeopsal", ko: "삼겹살 세트" },
        allergens: { en: "Pork, Soy, Sesame", ja: "豚肉、大豆、ごま", zh: "猪肉、大豆、芝麻", vi: "Thịt lợn, Đậu nành, Vừng", es: "Cerdo, Soya, Sésamo", ko: "돼지고기, 대두, 참깨" },
        // Exact real coordinates for Jeonpo Cafe Street area in Busan
        lat: 35.155823,
        lng: 129.063712,
        matchedFoodObj: {
          foodId: "samgyeopsal",
          name: "Samgyeopsal (삼겹살구이)",
          ingredients: "Pork, garlic, sesame oil, soybean paste (쌈장 - contains soybean, wheat)",
          allergens: ["pork", "soybean", "wheat"],
          crossContactAllergens: ["shellfish", "fish"], // Kimchi side dish may carry trace salted shrimp/fish sauce
          dietaryFlags: ["PORK", "NON-VEGAN"],
          spicy: 1,
          elements: [
            { name: "삼겹살 (Pork)", prob: "98%" },
            { name: "김치 (Kimchi)", prob: "94%" },
            { name: "쌈장 (Ssamjang)", prob: "88%" }
          ],
          eatingMethod: [
            "Grill the pork belly slices until golden brown on both sides.",
            "Place a fresh lettuce or perilla leaf flat in your palm.",
            "Set a slice of grilled pork belly in the center of the leaf.",
            "Add a dab of ssamjang and a slice of garlic on top.",
            "Wrap the leaf around the ingredients and eat it in one single bite!"
          ],
          culturalNote: "Koreans love to enjoy this dish with friends and family alongside a glass of Soju.",
          image: "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&q=80&w=600"
        }
      },
      {
        id: 1,
        name: "Mapbusim Maratang Jeonpo",
        nameKo: "맵부심 마라탕 전포점",
        category: "restaurant",
        categoryDisplay: { en: "CHINESE HOTPOT", ja: "四川麻辣湯専門店", zh: "川味麻辣烫", vi: "Lẩu Tứ Xuyên Maratang", es: "HOTPOT CHINO", ko: "사천식 마라탕" },
        rating: "4.7",
        desc: {
          en: "Spicy Sichuan style Malatang hotpot. Highly customisable ingredients selection.",
          ja: "刺激的なスパイスが効いた四川風マーラータン。トッピングを自由に選べます。",
          zh: "刺激辛辣的川式麻辣烫，配料自选度极高，深受年轻一代旅客喜爱。",
          vi: "Món lẩu Malatang cay nồng kiểu Tứ Xuyên. Có thể tự chọn nguyên liệu phong phú.",
          es: "Hotpot Malatang picante al estilo de Sichuan. Selección de ingredientes muy personalizable.",
          ko: "얼얼하고 매운 사천식 마라탕. 재료를 원하는 대로 골라 담을 수 있어요."
        },
        mainDish: { en: "Custom Malatang", ja: "カスタム麻辣湯", zh: "自选麻辣烫", vi: "Lẩu Malatang Tự Chọn", es: "Malatang Personalizado", ko: "커스텀 마라탕" },
        allergens: { en: "Peanuts, Beef, Gluten, Chili", ja: "ピーナッツ、牛肉、小麦、唐辛子", zh: "花生、牛肉、麸质、辣椒", vi: "Đậu phộng, Thịt bò, Gluten, Ớt", es: "Maní, Res, Gluten, Chile", ko: "땅콩, 소고기, 밀, 고추" },
        lat: 35.156541,
        lng: 129.064505,
        matchedFoodObj: {
          foodId: "malatang",
          name: "Malatang (마라탕)",
          ingredients: "Beef, peanut sauce (마장), chili oil, wheat noodles, tofu",
          allergens: ["peanut", "beef", "wheat", "soybean"],
          crossContactAllergens: ["sesame"],
          dietaryFlags: ["NON-VEGAN", "SPICY"],
          spicy: 3,
          elements: [
            { name: "마라탕 (Malatang)", prob: "96%" },
            { name: "소고기 (Beef)", prob: "91%" },
            { name: "땅콩소스 (Peanut)", prob: "95%" }
          ],
          eatingMethod: [
            "Choose your own noodles, meat, and vegetable toppings at the counter.",
            "The broth is simmered with numbing Sichuan peppercorns and chili oil.",
            "Mix well before eating so the peanut sauce coats every ingredient.",
            "Pair with a cold barley tea to balance the heat and numbing spice."
          ],
          culturalNote: "Malatang became hugely popular with young Koreans for its build-your-own customization.",
          image: "https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&q=80&w=600"
        }
      },
      {
        id: 2,
        name: "Vintage Oven Baker",
        nameKo: "빈티지 오븐 베이커",
        category: "cafe",
        categoryDisplay: { en: "BAKERY & CAFE", ja: "欧風アンティークベーカリー", zh: "欧式复古面包烘焙", vi: "Tiệm Bánh Cổ Điển", es: "PANADERÍA Y CAFÉ", ko: "베이커리 & 카페" },
        rating: "4.9",
        desc: {
          en: "Cozy cafe with freshly baked salt butter rolls and drip coffee.",
          ja: "焼きたての塩パンや香り高いハンドドリップコーヒーを楽しめる、静かで心地よいカフェ。",
          zh: "每天清晨新鲜出炉盐面包与精品手冲咖啡的复古温馨烘焙坊。",
          vi: "Quán cafe ấm cúng với bánh mì muối bơ mới ra lò và cafe phin thượng hạng.",
          es: "Cafetería acogedora con pan de mantequilla con sal recién horneado y café de goteo.",
          ko: "갓 구운 소금빵과 향긋한 드립 커피를 즐길 수 있는 아늑한 카페입니다."
        },
        mainDish: { en: "Salt Butter Bread", ja: "焼きたて塩パン", zh: "招牌盐面包", vi: "Bánh Mì Muối Bơ", es: "Pan de Mantequilla con Sal", ko: "소금빵" },
        allergens: { en: "Milk, Butter, Wheat", ja: "乳、バター、小麦", zh: "牛奶、黄油、小麦", vi: "Sữa, Bơ, Lúa mì", es: "Leche, Mantequilla, Trigo", ko: "우유, 버터, 밀" },
        lat: 35.154955,
        lng: 129.062810,
        matchedFoodObj: {
          foodId: "saltbread",
          name: "Salt Butter Bread (소금빵)",
          ingredients: "Wheat flour, butter (dairy), yeast, sea salt",
          allergens: ["milk", "wheat"],
          crossContactAllergens: ["egg"],
          dietaryFlags: ["VEGETARIAN"],
          spicy: 0,
          elements: [
            { name: "소금빵 (Salt Bread)", prob: "99%" },
            { name: "버터 (Butter)", prob: "96%" },
            { name: "밀가루 (Wheat)", prob: "97%" }
          ],
          eatingMethod: [
            "Best eaten fresh and warm, straight from the oven.",
            "Tear it by hand rather than slicing, to keep the buttery layers intact.",
            "Pairs perfectly with a hand-drip coffee or milk."
          ],
          culturalNote: "Sogeumppang (salt bread) became a nationwide bakery trend across Korea in recent years.",
          image: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&q=80&w=600"
        }
      },
      {
        id: 3,
        name: "Busan Marine Jeon",
        nameKo: "바다를 품은 해물파전",
        category: "restaurant",
        categoryDisplay: { en: "KOREAN SEAFOOD BISTRO", ja: "釜山海鮮チヂミ・マッコリ", zh: "釜山海鲜煎饼店", vi: "Quán Bánh Xèo Hải Sản Busan", es: "BISTRO DE MARISCOS", ko: "해산물 전문점" },
        rating: "4.6",
        desc: {
          en: "Crispy Korean pancake packed with squid, green onions, and fresh shrimp.",
          ja: "イカやネギ、新鮮なエビがどっさり入った、外はサクサク의海鮮チヂミが有名。",
          zh: "外皮焦脆，裹满鱿鱼、小葱及鲜虾的釜山代表性海鲜葱煎饼。",
          vi: "Bánh xèo hành kiểu Hàn Quốc giòn rụm với mực, hành lá và tôm tươi.",
          es: "Panceta coreana crujiente llena de calamar, cebolletas y camarones frescos.",
          ko: "오징어, 파, 신선한 새우가 듬뿍 들어간 바삭한 해물파전입니다."
        },
        mainDish: { en: "Seafood Scallion Pancake", ja: "海鮮ネギチヂミ", zh: "海鲜葱煎饼", vi: "Bánh Xèo Hải Sản", es: "Panqueque de Cebolleta y Mariscos", ko: "해물파전" },
        allergens: { en: "Shrimp, Squid, Wheat, Egg", ja: "エビ、イカ、小麦、卵", zh: "虾、鱿鱼、小麦、鸡蛋", vi: "Tôm, Mực, Lúa mì, Trứng", es: "Camarón, Calamar, Trigo, Huevo", ko: "새우, 오징어, 밀, 계란" },
        lat: 35.155410,
        lng: 129.064210,
        matchedFoodObj: {
          foodId: "haemulpajeon",
          name: "Haemul Pajeon (해물파전)",
          ingredients: "Squid, shrimp, wheat flour, egg batter, green scallions",
          allergens: ["squid", "shrimp", "wheat", "egg"],
          crossContactAllergens: ["soybean"],
          dietaryFlags: ["NON-VEGAN"],
          spicy: 1,
          elements: [
            { name: "해물파전 (Pancake)", prob: "95%" },
            { name: "오징어 (Squid)", prob: "91%" },
            { name: "새우 (Shrimp)", prob: "89%" }
          ],
          eatingMethod: [
            "Cut the crispy pancake into bite-sized wedges with the side of your spoon.",
            "Dip each piece into the soy-vinegar sauce (initanjang) before eating.",
            "Traditionally enjoyed with a bowl of makgeolli (rice wine), especially on rainy days."
          ],
          culturalNote: "Koreans have a saying that rainy days call for pajeon and makgeolli together.",
          image: "https://images.unsplash.com/photo-1598214813590-c64a7f070e3b?auto=format&fit=crop&q=80&w=600"
        }
      },
      {
        id: 4,
        name: "Jeonpo Home-Style Gyeranjjim",
        nameKo: "전포 계란찜 백반",
        category: "restaurant",
        categoryDisplay: { en: "KOREAN COMFORT FOOD", ja: "韓国家庭料理", zh: "韩式家常菜", vi: "Món Ăn Hàn Quốc Thanh Đạm", es: "COMIDA CASERA COREANA", ko: "한식 가정식" },
        rating: "4.7",
        desc: {
          en: "Fluffy steamed egg custard and mixed rice bowls with almost no spice — gentle on sensitive stomachs.",
          ja: "ふわふわの卵蒸しとビビンバなど、辛さを抑えた優しい味の韓国家庭料理。",
          zh: "松软鸡蛋羹与拌饭等清淡家常菜，几乎不辣，肠胃敏感的旅客也能放心享用。",
          vi: "Trứng hấp mềm mịn và cơm trộn ít cay, dễ ăn cho cả những ai bụng yếu.",
          es: "Suave flan de huevo al vapor y bibimbap con poco picante, ideal para estómagos sensibles.",
          ko: "부드러운 계란찜과 슴슴한 비빔밥 등 자극적이지 않은 편안한 한식 가정식입니다."
        },
        mainDish: { en: "Gyeranjjim & Bibimbap Set", ja: "卵蒸しビビンバセット", zh: "鸡蛋羹拌饭套餐", vi: "Set Trứng Hấp & Cơm Trộn", es: "Set de Gyeranjjim y Bibimbap", ko: "계란찜 비빔밥 세트" },
        allergens: { en: "Egg, Soy, Sesame", ja: "卵、大豆、ごま", zh: "鸡蛋、大豆、芝麻", vi: "Trứng, Đậu nành, Vừng", es: "Huevo, Soya, Sésamo", ko: "계란, 대두, 참깨" },
        lat: 35.156200,
        lng: 129.062500,
        matchedFoodObj: {
          foodId: "gyeranjjim",
          name: "Gyeranjjim (계란찜)",
          ingredients: "Egg, water, salt, sesame oil, chopped scallion",
          allergens: ["egg", "sesame"],
          crossContactAllergens: ["soybean"],
          dietaryFlags: ["VEGETARIAN"],
          spicy: 0,
          elements: [
            { name: "계란찜 (Egg Custard)", prob: "97%" },
            { name: "비빔밥 (Bibimbap)", prob: "93%" },
            { name: "된장국 (Soybean Soup)", prob: "85%" }
          ],
          eatingMethod: [
            "Scoop the fluffy steamed egg straight from its hot stone pot — it keeps cooking at the table.",
            "Mix the bibimbap thoroughly with the small amount of sauce provided before eating.",
            "Share the egg custard as a side dish alongside the rest of the meal."
          ],
          culturalNote: "Gyeranjjim is often served as a mild side dish so that even young children and sensitive eaters can enjoy Korean food.",
          image: "https://images.unsplash.com/photo-1583224964978-2e5b0e0c0e6e?auto=format&fit=crop&q=80&w=600"
        }
      },
      {
        id: 5,
        name: "Jeonpo Halal Chicken House",
        nameKo: "전포 할랄 치킨하우스",
        category: "restaurant",
        categoryDisplay: { en: "HALAL-FRIENDLY FRIED CHICKEN", ja: "ハラール対応フライドチキン", zh: "清真炸鸡专门店", vi: "Gà Rán Chuẩn Halal", es: "POLLO FRITO APTO HALAL", ko: "할랄 프라이드 치킨" },
        rating: "4.6",
        desc: {
          en: "Certified halal fried chicken with a choice of soy-garlic or spicy glaze, popular with Muslim travelers.",
          ja: "ハラール認証済みのフライドチキン。しょうゆニンニク味と辛味ソースから選べます。",
          zh: "获得清真认证的炸鸡，可选酱油蒜香或辣味酱汁，深受穆斯林旅客喜爱。",
          vi: "Gà rán đạt chứng nhận Halal, có thể chọn sốt tỏi tương hoặc sốt cay, được du khách Hồi giáo yêu thích.",
          es: "Pollo frito certificado halal con salsa de soja y ajo o salsa picante, muy popular entre viajeros musulmanes.",
          ko: "할랄 인증을 받은 프라이드 치킨으로, 간장마늘 또는 매운 양념 중 선택할 수 있어 무슬림 여행자들에게 인기가 많습니다."
        },
        mainDish: { en: "Halal Fried Chicken Set", ja: "ハラールフライドチキンセット", zh: "清真炸鸡套餐", vi: "Set Gà Rán Halal", es: "Set de Pollo Frito Halal", ko: "할랄 치킨 세트" },
        allergens: { en: "Wheat, Soy, Milk", ja: "小麦、大豆、乳", zh: "小麦、大豆、牛奶", vi: "Lúa mì, Đậu nành, Sữa", es: "Trigo, Soya, Leche", ko: "밀, 대두, 우유" },
        lat: 35.154600,
        lng: 129.064800,
        matchedFoodObj: {
          foodId: "halalchicken",
          name: "Halal Fried Chicken (할랄 치킨)",
          ingredients: "Chicken, wheat batter, soy-garlic or spicy chili glaze, buttermilk brine",
          allergens: ["chicken", "wheat", "soybean"],
          crossContactAllergens: ["milk"],
          dietaryFlags: ["HALAL", "NON-VEGAN"],
          spicy: 2,
          elements: [
            { name: "할랄치킨 (Halal Chicken)", prob: "97%" },
            { name: "간장마늘소스 (Soy Garlic)", prob: "90%" },
            { name: "매운양념 (Spicy Glaze)", prob: "88%" }
          ],
          eatingMethod: [
            "Choose between soy-garlic (mild) or spicy glaze when ordering.",
            "Eat with pickled radish (chikin-mu) to cut through the richness.",
            "Best enjoyed freshly fried and hot, shared among friends."
          ],
          culturalNote: "Halal-certified fried chicken has become more common across Korea as more Muslim travelers visit each year.",
          image: "https://images.unsplash.com/photo-1626645738196-c2a7c87a8f58?auto=format&fit=crop&q=80&w=600"
        }
      },
      {
        id: 6,
        name: "Jeonpo Brew Roastery",
        nameKo: "전포 브루 로스터리",
        category: "cafe",
        categoryDisplay: { en: "SPECIALTY COFFEE ROASTERY", ja: "スペシャルティコーヒー焙煎所", zh: "精品咖啡烘焙工坊", vi: "Xưởng Rang Cà Phê Đặc Sản", es: "TOSTADURÍA DE CAFÉ DE ESPECIALIDAD", ko: "스페셜티 커피 로스터리" },
        rating: "4.8",
        desc: {
          en: "Minimalist roastery serving single-origin hand-drip coffee and buttery scones.",
          ja: "シングルオリジンのハンドドリップコーヒーとバタースコーンが楽しめるミニマルな焙煎所。",
          zh: "极简风格烘焙工坊，供应单一产地手冲咖啡与黄油司康饼。",
          vi: "Xưởng rang cà phê tối giản với cà phê phin nguồn gốc đơn và bánh scone bơ.",
          es: "Tostaduría minimalista que sirve café de origen único con método de goteo y scones de mantequilla.",
          ko: "싱글 오리진 원두로 내린 핸드드립 커피와 버터 스콘을 즐길 수 있는 미니멀한 로스터리입니다."
        },
        mainDish: { en: "Hand-Drip Coffee & Scone", ja: "ハンドドリップコーヒー&スコーン", zh: "手冲咖啡与司康饼", vi: "Cà Phê Phin & Bánh Scone", es: "Café de Goteo y Scone", ko: "핸드드립 커피 & 스콘" },
        allergens: { en: "Milk, Wheat, Egg", ja: "乳、小麦、卵", zh: "牛奶、小麦、鸡蛋", vi: "Sữa, Lúa mì, Trứng", es: "Leche, Trigo, Huevo", ko: "우유, 밀, 계란" },
        lat: 35.155000,
        lng: 129.063200,
        matchedFoodObj: {
          foodId: "brewcoffee",
          name: "Hand-Drip Coffee & Scone (핸드드립 커피 & 스콘)",
          ingredients: "Single-origin coffee beans, butter scone (wheat, milk, egg)",
          allergens: ["milk", "wheat", "egg"],
          crossContactAllergens: [],
          dietaryFlags: ["VEGETARIAN"],
          spicy: 0,
          elements: [
            { name: "핸드드립 (Hand-Drip)", prob: "98%" },
            { name: "버터스콘 (Butter Scone)", prob: "92%" }
          ],
          eatingMethod: [
            "Let the hand-drip coffee cool slightly to bring out its fruity notes.",
            "Split the scone and add the accompanying jam or butter before eating.",
            "Pairs well with a quiet seat by the window for people-watching on Jeonpo Cafe Street."
          ],
          culturalNote: "Jeonpo-dong is known as one of Busan's trendiest cafe streets, packed with small independent roasteries like this one.",
          image: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&q=80&w=600"
        }
      },
      {
        id: 7,
        name: "Sweet Bingsu House",
        nameKo: "달콤 빙수하우스",
        category: "cafe",
        categoryDisplay: { en: "KOREAN SHAVED ICE DESSERT", ja: "韓国かき氷（ビンス）専門店", zh: "韩式刨冰甜品店", vi: "Quán Đá Bào Kiểu Hàn (Bingsu)", es: "POSTRE COREANO DE HIELO RASPADO", ko: "빙수 디저트 카페" },
        rating: "4.7",
        desc: {
          en: "Fluffy milk shaved ice topped with sweet red beans, rice cake, and roasted soybean powder.",
          ja: "ふわふわのミルクかき氷に、あんこや餅、きな粉をトッピングした一品。",
          zh: "松软绵密的牛奶刨冰，配上红豆、年糕与黄豆粉，清爽解暑。",
          vi: "Đá bào sữa mịn phủ đậu đỏ ngọt, bánh gạo và bột đậu nành rang.",
          es: "Hielo raspado de leche esponjoso cubierto con frijoles rojos dulces, pastel de arroz y polvo de soya tostada.",
          ko: "부드러운 우유 빙수 위에 팥, 떡, 고소한 인절미 콩가루를 올린 디저트입니다."
        },
        mainDish: { en: "Injeolmi Bingsu", ja: "きな粉ビンス", zh: "黄豆粉刨冰", vi: "Bingsu Đậu Nành Injeolmi", es: "Bingsu Injeolmi", ko: "인절미 빙수" },
        allergens: { en: "Milk, Soy", ja: "乳、大豆", zh: "牛奶、大豆", vi: "Sữa, Đậu nành", es: "Leche, Soya", ko: "우유, 대두" },
        lat: 35.156700,
        lng: 129.063000,
        matchedFoodObj: {
          foodId: "bingsu",
          name: "Injeolmi Bingsu (인절미 빙수)",
          ingredients: "Shaved milk ice, sweet red beans, rice cake (injeolmi), roasted soybean powder",
          allergens: ["milk", "soybean"],
          crossContactAllergens: ["walnut"],
          dietaryFlags: ["VEGETARIAN"],
          spicy: 0,
          elements: [
            { name: "빙수 (Shaved Ice)", prob: "98%" },
            { name: "인절미 (Rice Cake)", prob: "94%" },
            { name: "팥 (Red Bean)", prob: "90%" }
          ],
          eatingMethod: [
            "Mix everything together gently from the top before the ice melts.",
            "Share one large bowl with friends — bingsu is traditionally a social dessert.",
            "Eat quickly on hot summer days since the shaved ice melts fast!"
          ],
          culturalNote: "Bingsu is a beloved summer treat in Korea, with cafes competing every year to create new creative toppings.",
          image: "https://images.unsplash.com/photo-1488900128323-21503983a07e?auto=format&fit=crop&q=80&w=600"
        }
      },
      {
        id: 8,
        name: "Halmae Dwaeji Gukbap",
        nameKo: "할매 돼지국밥",
        category: "restaurant",
        categoryDisplay: { en: "KOREAN PORK SOUP", ja: "釜山名物 豚骨スープ食堂", zh: "釜山猪骨汤饭店", vi: "Quán Súp Xương Heo Busan", es: "SOPA COREANA DE CERDO", ko: "부산식 돼지국밥집" },
        rating: "4.6",
        desc: {
          en: "Busan's signature slow-simmered pork bone soup with rice, served with fresh scallions and salted shrimp.",
          ja: "釜山名物、豚骨をじっくり煮込んだ濃厚スープにご飯を入れた郷土料理。ネギと塩辛エビを添えて。",
          zh: "釜山代表美食，猪骨长时间熬制的浓郁汤饭，配上葱花和虾酱一起享用。",
          vi: "Món súp xương heo hầm lâu đặc trưng của Busan ăn kèm cơm, hành lá tươi và mắm tôm mặn.",
          es: "Sopa de hueso de cerdo cocida a fuego lento, típica de Busan, servida con arroz, cebolleta y camarón salado.",
          ko: "부산의 대표 향토음식. 사골과 돼지뼈를 오래 고아낸 진한 국물에 밥을 말아 부추와 새우젓을 곁들여 먹습니다."
        },
        mainDish: { en: "Dwaeji Gukbap", ja: "テジクッパ", zh: "猪骨汤饭", vi: "Dwaeji Gukbap", es: "Dwaeji Gukbap", ko: "돼지국밥" },
        allergens: { en: "Pork, Shrimp, Soy", ja: "豚肉、エビ、大豆", zh: "猪肉、虾、大豆", vi: "Thịt lợn, Tôm, Đậu nành", es: "Cerdo, Camarón, Soya", ko: "돼지고기, 새우, 대두" },
        lat: 35.154900,
        lng: 129.062100,
        matchedFoodObj: {
          foodId: "dwaejigukbap",
          name: "Dwaeji Gukbap (돼지국밥)",
          ingredients: "Pork bone broth, pork slices, rice, scallion, salted shrimp (새우젓), doenjang",
          allergens: ["pork", "shrimp", "soybean"],
          crossContactAllergens: ["squid"],
          dietaryFlags: ["PORK", "NON-VEGAN"],
          spicy: 1,
          elements: [
            { name: "돼지국밥 (Pork Soup)", prob: "97%" },
            { name: "새우젓 (Salted Shrimp)", prob: "89%" },
            { name: "부추 (Scallion/Chive)", prob: "85%" }
          ],
          eatingMethod: [
            "Stir in a spoonful of salted shrimp (saeujeot) to taste — it seasons the broth.",
            "Add chopped chives and a dab of chili paste if you'd like more kick.",
            "Eat it hot, straight from the stone bowl, with a side of kkakdugi (radish kimchi)."
          ],
          culturalNote: "Dwaeji gukbap was born in Busan during the Korean War, when pork bones were an affordable way to feed refugees a hearty meal.",
          image: "https://images.unsplash.com/photo-1580217593608-61931cefc821?auto=format&fit=crop&q=80&w=600"
        }
      },
      {
        id: 9,
        name: "Jeonpo Milmyeon House",
        nameKo: "전포 밀면집",
        category: "restaurant",
        categoryDisplay: { en: "BUSAN COLD NOODLES", ja: "釜山冷麺（ミルミョン）専門店", zh: "釜山冷面（小麦冷面）", vi: "Mì Lạnh Busan (Milmyeon)", es: "FIDEOS FRÍOS DE BUSAN", ko: "부산 밀면 전문점" },
        rating: "4.5",
        desc: {
          en: "Busan-style cold wheat noodles in a tangy, icy beef broth — a local summer favorite.",
          ja: "釜山名物のコシのある小麦冷麺。さっぱりとした牛肉ダシのシャーベット状スープが特徴。",
          zh: "釜山特色小麦冷面，配上冰镇牛肉高汤，酸辣爽口，是当地夏日必吃美食。",
          vi: "Mì lạnh làm từ bột mì kiểu Busan, ăn kèm nước dùng bò chua cay mát lạnh — món khoái khẩu mùa hè.",
          es: "Fideos fríos de trigo al estilo de Busan en un caldo de res agridulce y helado — favorito local del verano.",
          ko: "쫄깃한 밀가루 면을 새콤달콤하고 살얼음 낀 육수에 말아먹는 부산 대표 여름 음식입니다."
        },
        mainDish: { en: "Mul Milmyeon", ja: "水ミルミョン", zh: "水冷面", vi: "Mul Milmyeon", es: "Mul Milmyeon", ko: "물밀면" },
        allergens: { en: "Wheat, Egg, Beef", ja: "小麦、卵、牛肉", zh: "小麦、鸡蛋、牛肉", vi: "Lúa mì, Trứng, Thịt bò", es: "Trigo, Huevo, Res", ko: "밀, 계란, 소고기" },
        lat: 35.157200,
        lng: 129.065100,
        matchedFoodObj: {
          foodId: "milmyeon",
          name: "Milmyeon (밀면)",
          ingredients: "Wheat noodles, chilled beef broth, boiled egg, cucumber, chili paste",
          allergens: ["wheat", "egg", "beef"],
          crossContactAllergens: ["sesame"],
          dietaryFlags: ["NON-VEGAN"],
          spicy: 1,
          elements: [
            { name: "밀면 (Wheat Noodles)", prob: "96%" },
            { name: "육수 (Beef Broth)", prob: "90%" },
            { name: "삶은 계란 (Boiled Egg)", prob: "88%" }
          ],
          eatingMethod: [
            "Use scissors (usually on the table) to cut the long noodles for easier eating.",
            "Mix in the chili paste evenly before your first bite.",
            "Drink the icy broth straight from the bowl — it's meant to be enjoyed cold."
          ],
          culturalNote: "Milmyeon was invented by North Korean refugees in Busan who substituted wheat flour for buckwheat, which was scarce after the war.",
          image: "https://images.unsplash.com/photo-1626804475297-411f0eb00cd5?auto=format&fit=crop&q=80&w=600"
        }
      },
      {
        id: 10,
        name: "Jeonpo Eomuk Bar",
        nameKo: "전포 오뎅바",
        category: "restaurant",
        categoryDisplay: { en: "KOREAN FISH CAKE STALL", ja: "韓国式おでん（オムク）屋台", zh: "韩式关东煮（鱼糕）摊", vi: "Quầy Chả Cá Hàn Quốc", es: "PUESTO DE PASTEL DE PESCADO", ko: "오뎅 포장마차" },
        rating: "4.4",
        desc: {
          en: "Steaming hot fish cake skewers simmered in savory broth — a beloved street-food stop.",
          ja: "旨味たっぷりの出汁で煮込んだ、湯気の立つ串刺しの練り物。人気の屋台グルメ。",
          zh: "在鲜香高汤中炖煮的热腾腾鱼糕串，是深受喜爱的街头小吃。",
          vi: "Chả cá xiên que nóng hổi ninh trong nước dùng đậm đà — món ăn vặt đường phố được yêu thích.",
          es: "Brochetas de pastel de pescado bien calientes cocidas en caldo sabroso — un puesto callejero muy popular.",
          ko: "감칠맛 나는 육수에 끓인 김이 모락모락 나는 오뎅 꼬치. 부담 없이 즐기는 길거리 인기 간식입니다."
        },
        mainDish: { en: "Skewered Eomuk", ja: "串オムク", zh: "鱼糕串", vi: "Chả Cá Xiên", es: "Eomuk en Brocheta", ko: "꼬치 오뎅" },
        allergens: { en: "Fish, Wheat, Egg", ja: "魚、小麦、卵", zh: "鱼、小麦、鸡蛋", vi: "Cá, Lúa mì, Trứng", es: "Pescado, Trigo, Huevo", ko: "생선, 밀, 계란" },
        lat: 35.155100,
        lng: 129.065800,
        matchedFoodObj: {
          foodId: "eomukbar",
          name: "Eomuk / Odeng (오뎅)",
          ingredients: "Pressed white fish cake (pollock/mackerel), wheat flour binder, egg, anchovy-kelp broth",
          allergens: ["mackerel", "wheat", "egg"],
          crossContactAllergens: ["shellfish"],
          dietaryFlags: ["NON-VEGAN"],
          spicy: 0,
          elements: [
            { name: "오뎅 (Fish Cake)", prob: "95%" },
            { name: "육수 (Broth)", prob: "90%" },
            { name: "무 (Radish)", prob: "80%" }
          ],
          eatingMethod: [
            "Pick a skewer straight from the simmering broth pot.",
            "Sip the free broth from a paper cup while you eat — it's part of the experience.",
            "Dip in soy sauce with a bit of chili if the stall offers it."
          ],
          culturalNote: "Busan is Korea's fish cake capital — many national eomuk brands got their start in this port city.",
          image: "https://images.unsplash.com/photo-1582878826629-29b7ad1cdc43?auto=format&fit=crop&q=80&w=600"
        }
      },
      {
        id: 11,
        name: "Baetteok Ssiat Hotteok",
        nameKo: "배떡 씨앗호떡",
        category: "cafe",
        categoryDisplay: { en: "STREET SNACK STALL", ja: "種入り甘いホットク屋台", zh: "坚果籽甜煎饼摊", vi: "Quầy Bánh Hotteok Hạt", es: "PUESTO DE HOTTEOK", ko: "씨앗호떡 노점" },
        rating: "4.7",
        desc: {
          en: "Crispy-fried sweet pancake stuffed with brown sugar syrup and crunchy sunflower seeds.",
          ja: "外はカリッと中はとろりと甘い黒糖シロップに、香ばしいひまわりの種がたっぷり入ったホットク。",
          zh: "外酥内软的甜煎饼，馅料是浓郁红糖浆和香脆葵花籽，一口爆浆。",
          vi: "Bánh chiên giòn nhân syrup đường nâu ngọt ngào, rắc thêm hạt hướng dương giòn tan.",
          es: "Panqueque dulce frito y crujiente relleno de sirope de azúcar morena y semillas de girasol.",
          ko: "바삭하게 튀긴 반죽 안에 달콤한 흑설탕 시럽과 고소한 해바라기씨가 가득 든 길거리 간식입니다."
        },
        mainDish: { en: "Ssiat Hotteok", ja: "種入りホットク", zh: "坚果籽糖饼", vi: "Hotteok Hạt", es: "Ssiat Hotteok", ko: "씨앗호떡" },
        allergens: { en: "Wheat, Peanut", ja: "小麦、ピーナッツ", zh: "小麦、花生", vi: "Lúa mì, Đậu phộng", es: "Trigo, Maní", ko: "밀, 땅콩" },
        lat: 35.156300,
        lng: 129.062400,
        matchedFoodObj: {
          foodId: "ssiathotteok",
          name: "Ssiat Hotteok (씨앗호떡)",
          ingredients: "Wheat flour dough, brown sugar syrup, sunflower seeds, peanuts, cinnamon",
          allergens: ["wheat", "peanut"],
          crossContactAllergens: ["walnut"],
          dietaryFlags: ["VEGETARIAN"],
          spicy: 0,
          elements: [
            { name: "호떡 (Hotteok)", prob: "97%" },
            { name: "씨앗 (Seeds)", prob: "92%" },
            { name: "흑설탕 시럽 (Brown Sugar Syrup)", prob: "90%" }
          ],
          eatingMethod: [
            "Eat it straight from the paper cup it's served in — it's served piping hot.",
            "Blow on it first! The molten sugar syrup inside stays very hot for a while.",
            "Best enjoyed slowly walking down the street on a cold day."
          ],
          culturalNote: "Ssiat hotteok is a Busan-born twist on the classic hotteok, adding crunchy seeds that spread nationwide from this very neighborhood.",
          image: "https://images.unsplash.com/photo-1541599468348-e96984315921?auto=format&fit=crop&q=80&w=600"
        }
      },
      {
        id: 12,
        name: "Sanjeong Hanbang Tea House",
        nameKo: "산정 한방찻집",
        category: "cafe",
        categoryDisplay: { en: "TRADITIONAL TEA HOUSE", ja: "韓方伝統茶房", zh: "韩方传统茶馆", vi: "Quán Trà Thảo Dược Truyền Thống", es: "CASA DE TÉ TRADICIONAL", ko: "전통 한방차 카페" },
        rating: "4.8",
        desc: {
          en: "Quiet hanok-style tea house serving warm herbal teas made from ginseng, jujube, and cinnamon.",
          ja: "韓屋造りの静かな茶房。高麗人参やナツメ、シナモンを使った温かい韓方茶を提供。",
          zh: "安静的韩屋风格茶馆，供应人参、红枣、肉桂熬制的暖身韩方茶。",
          vi: "Quán trà yên tĩnh kiểu nhà hanok, phục vụ trà thảo dược ấm từ nhân sâm, táo tàu và quế.",
          es: "Casa de té tranquila estilo hanok que sirve tés de hierbas cálidos hechos con ginseng, azufaifa y canela.",
          ko: "고즈넉한 한옥 찻집에서 인삼, 대추, 계피로 우려낸 따뜻한 한방차를 즐길 수 있습니다."
        },
        mainDish: { en: "Ssanghwa-cha", ja: "双和茶", zh: "双和茶", vi: "Trà Ssanghwa", es: "Té Ssanghwa", ko: "쌍화차" },
        allergens: { en: "Pine nuts", ja: "松の実", zh: "松子", vi: "Hạt thông", es: "Piñones", ko: "잣" },
        lat: 35.154400,
        lng: 129.064600,
        matchedFoodObj: {
          foodId: "teahouse",
          name: "Ssanghwa-cha (쌍화차)",
          ingredients: "Ginseng, jujube, cinnamon, licorice root, honey, pine nut garnish",
          allergens: ["pinenut"], // [IMP-11] 'pineneut'(오타) -> 'pinenut'(표준 id)
          crossContactAllergens: [],
          dietaryFlags: ["VEGETARIAN", "HALAL"],
          spicy: 0,
          elements: [
            { name: "쌍화차 (Herbal Tea)", prob: "96%" },
            { name: "잣 고명 (Pine Nut Garnish)", prob: "85%" }
          ],
          eatingMethod: [
            "Stir gently before drinking — the honey settles at the bottom.",
            "Sip slowly while it's hot; it's meant to be a relaxing, warming drink.",
            "Eat the soft-boiled egg yolk on top, a traditional garnish, if included."
          ],
          culturalNote: "Ssanghwa-cha has been used in Korea for centuries as a warming remedy for colds and fatigue, long before it became a cafe drink.",
          image: "https://images.unsplash.com/photo-1597318181409-cf64d0b5d8ee?auto=format&fit=crop&q=80&w=600"
        }
      },
      {
        id: 13,
        name: "Jeonpo Bubble & Waffle",
        nameKo: "전포 버블앤와플",
        category: "cafe",
        categoryDisplay: { en: "BUBBLE TEA & WAFFLE CAFE", ja: "タピオカ＆ワッフルカフェ", zh: "珍珠奶茶和华夫饼咖啡厅", vi: "Quán Trà Sữa & Waffle", es: "CAFÉ DE BUBBLE TEA Y GOFRES", ko: "버블티 & 와플 카페" },
        rating: "4.6",
        desc: {
          en: "Trendy photo-friendly cafe serving milk tea with chewy tapioca pearls and fresh cream waffles.",
          ja: "写真映えする人気カフェ。もちもちタピオカ入りミルクティーと生クリームワッフルが人気。",
          zh: "网红打卡咖啡厅，供应Q弹珍珠奶茶和新鲜奶油华夫饼。",
          vi: "Quán cafe sống ảo phổ biến với trà sữa trân châu dai và waffle kem tươi.",
          es: "Cafetería moderna y fotogénica que sirve té con leche y perlas de tapioca masticables junto con gofres de nata fresca.",
          ko: "쫄깃한 타피오카 버블티와 생크림 와플이 인기인 인스타 감성 카페입니다."
        },
        mainDish: { en: "Brown Sugar Bubble Milk Tea", ja: "黒糖タピオカミルクティー", zh: "黑糖珍珠奶茶", vi: "Trà Sữa Trân Châu Đường Nâu", es: "Té con Leche y Perlas de Azúcar Morena", ko: "흑당 버블 밀크티" },
        allergens: { en: "Milk, Wheat, Egg", ja: "乳、小麦、卵", zh: "牛奶、小麦、鸡蛋", vi: "Sữa, Lúa mì, Trứng", es: "Leche, Trigo, Huevo", ko: "우유, 밀, 계란" },
        lat: 35.157600,
        lng: 129.063100,
        matchedFoodObj: {
          foodId: "bubbletea",
          name: "Brown Sugar Bubble Milk Tea (흑당 버블티)",
          ingredients: "Black tea, milk, tapioca pearls, brown sugar syrup, waffle (wheat, egg, milk), whipped cream",
          allergens: ["milk", "wheat", "egg"],
          crossContactAllergens: ["soybean"],
          dietaryFlags: ["VEGETARIAN"],
          spicy: 0,
          elements: [
            { name: "버블티 (Bubble Tea)", prob: "97%" },
            { name: "타피오카 (Tapioca Pearls)", prob: "93%" },
            { name: "와플 (Waffle)", prob: "89%" }
          ],
          eatingMethod: [
            "Shake or stir well before drinking so the brown sugar mixes evenly.",
            "Use the wide bubble-tea straw to scoop up the tapioca pearls as you drink.",
            "Share the waffle at the table — it's cut into shareable pieces."
          ],
          culturalNote: "Brown sugar bubble tea swept through Korean cafes as a trend, often paired with a waffle for the perfect photo-worthy dessert set.",
          image: "https://images.unsplash.com/photo-1558857563-b371033873b8?auto=format&fit=crop&q=80&w=600"
        }
      }
    ];
