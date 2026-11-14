export class Item {
  constructor(typeId, amount = 1, { name = '', max = 64, damage = null, enchantments = [] } = {}) {
    this.typeId = typeId;
    this.amount = amount;
    this.nameTag = name;
    this.maxAmount = max;
    this.damage = damage;
    this.enchantments = enchantments;
  }
  clone() {
    return new Item(this.typeId, this.amount, { name: this.nameTag, max: this.maxAmount, damage: this.damage, enchantments: this.enchantments });
  }
  getLore() { return []; }
  getTags() { return []; }
  getDynamicPropertyIds() { return []; }
  getCanDestroy() { return []; }
  getCanPlaceOn() { return []; }
  getComponent(name) {
    if (name === 'minecraft:durability' && this.damage !== null) return { damage: this.damage };
    if (name === 'minecraft:enchantable') return { getEnchantments: () => this.enchantments };
  }
  isStackableWith(other) {
    return this.maxAmount > 1 && this.typeId === other.typeId && this.nameTag === other.nameTag && this.damage === other.damage;
  }
}
export class Inventory {
  constructor(size, items = {}) {
    this.size = size;
    this.items = new Map(Object.entries(items).map(([key, item]) => [Number(key), item.clone()]));
    this.failOnce = null;
  }
  get emptySlotsCount() { return this.size - this.items.size; }
  getItem(slot) { return this.items.get(slot)?.clone(); }
  setItem(slot, item) {
    if (this.failOnce === slot) { this.failOnce = null; throw new Error('injected write failure'); }
    if (item) this.items.set(slot, item.clone());
    else this.items.delete(slot);
  }
  total(type) { return [...this.items.values()].filter(item => item.typeId === type).reduce((n, item) => n + item.amount, 0); }
}
