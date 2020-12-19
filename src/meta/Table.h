/*
 * Copyright 2017-present Shawn Cao
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#pragma once

#include <unordered_map>
#include <unordered_set>

#include "Access.h"
#include "common/Errors.h"
#include "meta/Pod.h"
#include "type/Type.h"

/**
 * Define nebula table and system metadata 
 * which manages what data segments are loaded in memory for each table
 * This meta data can persist and sync with external DB system such as MYSQL or RocksDB
 * (A KV store is necessary for Nebula to manage all metadata)
 * 
 * (Also - Is this responsibility of zookeeper?)
 */
namespace nebula {
namespace meta {

using nebula::type::Kind;
using nebula::type::Schema;

// only save partition values as string
// if values is empty then the owner column is not a partition column
struct PartitionInfo {
  std::vector<std::string> values;
  size_t chunk;
  inline bool valid() const {
    return chunk > 0 && values.size() > 0;
  }
};

// Bucket info is used to support reading specific bucket based on
// a given bucketed column value.
// Right now, we only support numeric column value mod on bucket count
struct BucketInfo {
  explicit BucketInfo(size_t c, const std::string& bc)
    : count{ c }, bucketColumn{ bc } {}

  size_t count;
  std::string bucketColumn;

  size_t bucket(size_t columnValue) const {
    return columnValue % count;
  }

  static BucketInfo empty() {
    static const BucketInfo EMPTY{ 0, "" };
    return EMPTY;
  }
};

struct CustomColumn {
  explicit CustomColumn(const std::string& n, Kind k, const std::string& e)
    : name{ n }, kind{ k }, expr{ e } {}

  std::string name;
  Kind kind;
  std::string expr;
};

/**
 * Define column properties that fetched from meta data system
 */
struct Column {
  explicit Column(bool bf = false,
                  bool d = false,
                  bool c = false,
                  const std::string& dv = "",
                  std::vector<AccessRule> rls = {},
                  PartitionInfo pi = {})
    : withBloomFilter{ bf },
      withDict{ d },
      withCompress{ c },
      defaultValue{ dv },
      rules{ std::move(rls) },
      partition{ std::move(pi) } {}

  // by default, we don't build bloom filter
  bool withBloomFilter;

  // by default, we turn on dictionay for strings
  bool withDict;

  // by default, no compression turned on
  bool withCompress;

  // specify a default value in string
  // empty means no default value,
  // with saying that, we're not support string type with empty stirng as default value
  std::string defaultValue;

  // access rules
  std::vector<AccessRule> rules;

  // partition info - can be used to convert as PartitionKey
  PartitionInfo partition;
};

using ColumnProps = nebula::common::unordered_map<std::string, Column>;

using TypeLookup = std::function<nebula::type::Kind(const std::string&)>;

class Table {
public:
  Table(const std::string& name) : Table(name, nullptr, ColumnProps(), {}, nullptr) {}
  Table(const std::string& name, Schema schema, ColumnProps columns, AccessSpec rules, const std::string& ddl)
    : name_{ name }, schema_{ schema }, columns_{ std::move(columns) }, rules_{ std::move(rules) }, ddl_{std::move(ddl)} {
    // TODO(cao) - load table properties from meta data service
    loadTable();

    // build up pod object
    nebula::meta::Pod::KeyList keys;
    for (const auto& cp : columns_) {
      // this is a valid partition column
      const auto& part = cp.second.partition;
      if (part.valid()) {
        // TODO(cao): figure out the right type for partition key
        keys.emplace_back(makeKey(cp.first, part));
      }
    }
    pod_ = keys.size() == 0 ? nullptr : std::make_shared<Pod>(std::move(keys));

    // define type lookup
    lookup_ = [this](const std::string& col) {
      auto node = schema_->find(col);
      // found in existing schema
      if (node) {
        return node->k();
      }

      return nebula::type::Kind::INVALID;
    };
  }

  virtual ~Table() = default;

  friend bool operator==(const Table& t1, const Table& t2) noexcept {
    return t1.name_ == t2.name_;
  }

  // select *
  static constexpr auto ALL_COLUMNS = "*";

  // default reserved [time] field in nebula, every table has this field enforced.
  // move this to core/meta to be shared everywhere
  static constexpr auto TIME_COLUMN = "_time_";

  // window column is produced from time window based on windowing algorithm
  static constexpr auto WINDOW_COLUMN = "_window_";

public:
  virtual Schema schema() const {
    N_ENSURE_NOT_NULL(schema_, fmt::format("invalid table not found = {0}", name_));
    return schema_;
  }

  inline const std::string& name() const {
    return name_;
  }

  inline const  std::string& ddl() const {
    return ddl_;
  }

  // retrieve all column meta data by its name
  virtual const Column& column(const std::string& col) const noexcept {
    auto column = columns_.find(col);
    if (column != columns_.end()) {
      return column->second;
    }

    static const Column EMPTY{};
    return EMPTY;
  }

  inline const TypeLookup& lookup() const noexcept {
    return lookup_;
  }

  virtual std::shared_ptr<nebula::meta::Pod> pod() const noexcept {
    return pod_;
  }

  // TODO(cao): this may need refactoring to be a generic interface out of table class.
  // but right now, we're assuming we can make the decision through table object
  // This API will decide action type for given security groups and column
  // If column name is not given, it operates table level check
  virtual ActionType
    checkAccess(
      AccessType,
      const nebula::common::unordered_set<std::string>&,
      const std::string& col = "") const;

protected:
  // table name is global unique, but it can be organized by some namespace style naming convention
  // such as "nebula.test"
  std::string name_;
  Schema schema_;
  TypeLookup lookup_;
  ColumnProps columns_;
  // access rules, can be empty
  std::vector<AccessRule> rules_;
  // pod info if there are partition columns
  std::shared_ptr<nebula::meta::Pod> pod_;
  std::string ddl_;

private:
  void loadTable();
  std::unique_ptr<PK> makeKey(const std::string&, const PartitionInfo&) const;
};
} // namespace meta
} // namespace nebula